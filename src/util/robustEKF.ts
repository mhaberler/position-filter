/**
 * Robust Adaptive EKF — real-time heading & speed from GPS.
 *
 * State: [lat_deg, lon_deg, heading_rad, speed_mps]
 * Heading: clockwise from north — consistent with atan2(east, north) and Cesium.
 *
 * Extracted from templates/cesium-gpx.html; matrix ops use math.js.
 */

import {
  matrix,
  multiply,
  transpose,
  add,
  subtract,
  identity,
  inv,
  type Matrix,
} from 'mathjs';

// Approximate metres per degree of latitude
const R_EARTH = 111_111;

// Huber loss threshold for 2-DoF chi² (1.345 × √2)
const HUBER_K = 1.345 * Math.sqrt(2);

export interface EKFState {
  /** Latitude in degrees */
  lat: number;
  /** Longitude in degrees */
  lon: number;
  /** Heading in radians, clockwise from north */
  headingRad: number;
  /** Speed in m/s */
  speedMps: number;
}

export class RobustAdaptiveEKF {
  /** State vector [lat°, lon°, heading_rad, speed_m/s] */
  private x: number[];
  /** 4×4 error covariance */
  private P: Matrix;
  /** 4×4 process noise covariance (constant) */
  private readonly Q: Matrix;

  /**
   * @param lat         Initial latitude in degrees
   * @param lon         Initial longitude in degrees
   * @param headingRad  Initial heading, radians clockwise from north (default 0)
   * @param speedMps    Initial speed in m/s (default 0)
   */
  constructor(lat: number, lon: number, headingRad = 0, speedMps = 0) {
    this.x = [lat, lon, headingRad, speedMps];

    // Tight on position, diffuse on heading / speed
    this.P = matrix([
      [1e-8, 0,    0,            0 ],
      [0,    1e-8, 0,            0 ],
      [0,    0,    Math.PI ** 2, 0 ],
      [0,    0,    0,           25 ],
    ]);

    // Position driven by motion model; heading/speed free to vary
    this.Q = matrix([
      [1e-13, 0,     0,     0    ],
      [0,     1e-13, 0,     0    ],
      [0,     0,     1e-4,  0    ],
      [0,     0,     0,     0.25 ],
    ]);
  }

  // ─── Predict ──────────────────────────────────────────────────────────────

  /**
   * Time-update step — propagate state forward by `dtSeconds`.
   */
  predict(dtSeconds: number): void {
    const [lat, lon, h, v] = this.x;
    const cosLat = Math.cos(lat * Math.PI / 180);
    const dt = dtSeconds;

    // Non-linear propagation: constant heading, constant speed
    this.x = [
      lat + v * Math.cos(h) * dt / R_EARTH,
      lon + v * Math.sin(h) * dt / (R_EARTH * cosLat),
      h,
      v,
    ];

    // State-transition Jacobian F (4×4)
    const F = matrix([
      [1, 0, -v * Math.sin(h) * dt / R_EARTH,            Math.cos(h) * dt / R_EARTH            ],
      [0, 1,  v * Math.cos(h) * dt / (R_EARTH * cosLat), Math.sin(h) * dt / (R_EARTH * cosLat) ],
      [0, 0,  1,                                          0                                      ],
      [0, 0,  0,                                          1                                      ],
    ]);

    // P = F P Fᵀ + Q
    this.P = add(
      multiply(multiply(F, this.P), transpose(F)),
      this.Q,
    ) as Matrix;
  }

  // ─── Update ───────────────────────────────────────────────────────────────

  /**
   * Measurement-update step — fuse one GPS fix.
   * @param measLat  Measured latitude in degrees
   * @param measLon  Measured longitude in degrees
   */
  update(measLat: number, measLon: number): void {
    const cosLat = Math.cos(this.x[0] * Math.PI / 180);
    const innov = [measLat - this.x[0], measLon - this.x[1]];

    // GPS noise ≈ 3 m, converted to degrees²
    const rLat = (3 / R_EARTH) ** 2;
    const rLon = (3 / (R_EARTH * cosLat)) ** 2;

    // Innovation covariance  S = H P Hᵀ + R  (H selects lat/lon rows → first 2 rows of P)
    const P = this.P.toArray() as number[][];
    const S: number[][] = [
      [P[0][0] + rLat, P[0][1]        ],
      [P[1][0],        P[1][1] + rLon ],
    ];

    // Mahalanobis distance² — used for both adaptive inflation and Huber weighting
    const Si = (inv(matrix(S)) as Matrix).toArray() as number[][];
    const norm2 =
      innov[0] * (Si[0][0] * innov[0] + Si[0][1] * innov[1]) +
      innov[1] * (Si[1][0] * innov[0] + Si[1][1] * innov[1]);

    // Adaptive R: inflate diagonal when residual is large (handles GPS jumps)
    const adaptF = Math.max(1, norm2 / 2);
    const Sa = matrix([
      [S[0][0] * adaptF, S[0][1]          ],
      [S[1][0],          S[1][1] * adaptF ],
    ]);

    // Huber robustness weight: downweight outliers beyond ~1.345σ
    const wt = norm2 < HUBER_K ** 2 ? 1 : HUBER_K / Math.sqrt(norm2);

    // Kalman gain  K = P Hᵀ Sₐ⁻¹  (P Hᵀ = first 2 columns of P → 4×2 slice)
    const Sai = (inv(Sa) as Matrix).toArray() as number[][];
    const K = P.map(row => [
      row[0] * Sai[0][0] + row[1] * Sai[1][0],
      row[0] * Sai[0][1] + row[1] * Sai[1][1],
    ]);

    // State update
    for (let i = 0; i < 4; i++) {
      this.x[i] += wt * (K[i][0] * innov[0] + K[i][1] * innov[1]);
    }

    // Wrap heading to (−π, π]
    this.x[2] = ((this.x[2] % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI) - Math.PI;

    // Covariance update  P = (I − KH) P
    const KH = matrix(K.map(row => [row[0], row[1], 0, 0]));
    this.P = multiply(subtract(identity(4) as Matrix, KH), this.P) as Matrix;
  }

  // ─── Accessors ────────────────────────────────────────────────────────────

  /** Heading in radians, clockwise from north, range (−π, π] */
  getHeading(): number {
    return this.x[2];
  }

  /** Heading in degrees [0°, 360°), clockwise from north */
  getHeadingDeg(): number {
    return ((this.x[2] * 180 / Math.PI) % 360 + 360) % 360;
  }

  /** Speed in m/s (EKF state; may be slightly negative near cold-start) */
  getSpeed(): number {
    return this.x[3];
  }

  /** Speed in km/h */
  getSpeedKmh(): number {
    return this.x[3] * 3.6;
  }

  /** Full state snapshot */
  getState(): EKFState {
    const [lat, lon, headingRad, speedMps] = this.x;
    return { lat, lon, headingRad, speedMps };
  }
}
