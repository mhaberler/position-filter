import * as math from 'mathjs';

export interface EKFState { lat: number; lon: number; headingRad: number; speedMps: number; }

export class RobustAdaptiveEKF {
  private x: math.Matrix; private P: math.Matrix; private Q: math.Matrix; private R: math.Matrix;
  private readonly EARTH_R = 6378137; private readonly MAX_SPEED = 150 / 3.6;
  private readonly HUBER_K = 1.345 * Math.sqrt(2);

  constructor(lat: number, lon: number, headingRad = 0, speedMps = 0) {
    this.x = math.matrix([[lat],[lon],[headingRad],[Math.max(0,Math.min(this.MAX_SPEED,speedMps))]]);
    this.P = math.diag([1e-4,1e-4,1,25]);
    this.Q = math.diag([1e-5,1e-5,0.01,0.5]);
    this.R = math.diag([1e-5,1e-5]);
  }

  predict(dt: number): void {
    if (dt <= 0) return;
    let [lat, lon, h, v] = [this.x.get([0,0]), this.x.get([1,0]), this.x.get([2,0]), Math.max(0, Math.min(this.MAX_SPEED, this.x.get([3,0])) )];
    const phi = lat * Math.PI / 180;
    let cosPhi = Math.cos(phi); if (Math.abs(cosPhi) < 1e-8) cosPhi = 1e-8;
    const s = dt * (180 / Math.PI) / this.EARTH_R;
    const latN = lat + s * v * Math.cos(h);
    const lonN = lon + s * v * Math.sin(h) / cosPhi;
    let hN = ((h + Math.PI) % (2 * Math.PI)) - Math.PI;
    this.x = math.matrix([[latN],[lonN],[hN],[v]]);

    const dlon_dlat = s * v * Math.sin(h) * Math.sin(phi) / (cosPhi * cosPhi) * (Math.PI / 180);
    const F = math.matrix([[1,0,-s*v*Math.sin(h),s*Math.cos(h)],[dlon_dlat,1,s*v*Math.cos(h)/cosPhi,s*Math.sin(h)/cosPhi],[0,0,1,0],[0,0,0,1]]);
    this.P = math.add(math.multiply(math.multiply(F, this.P), math.transpose(F)), this.Q);
  }

  update(measLat: number, measLon: number): void {
    const z = math.matrix([[measLat],[measLon]]);
    const hx = math.matrix([[this.x.get([0,0])],[this.x.get([1,0])]]);
    const innov = math.subtract(z, hx);
    const H = math.matrix([[1,0,0,0],[0,1,0,0]]);
    let S = math.add(math.multiply(math.multiply(H, this.P), math.transpose(H)), this.R);
    let Sinv = math.inv(S);
    let norm2Mat = math.multiply(math.multiply(math.transpose(innov), Sinv), innov);
    let norm2 = norm2Mat.get([0,0]) || 0;

    const adaptF = Math.max(1, norm2 / 2);
    const R_adapt = math.multiply(this.R, adaptF);
    S = math.add(math.multiply(math.multiply(H, this.P), math.transpose(H)), R_adapt);
    Sinv = math.inv(S);

    const K = math.multiply(math.multiply(this.P, math.transpose(H)), Sinv);

    norm2Mat = math.multiply(math.multiply(math.transpose(innov), Sinv), innov);
    norm2 = norm2Mat.get([0,0]) || 0;

    const thresh2 = this.HUBER_K * this.HUBER_K;
    const wt = norm2 > thresh2 ? this.HUBER_K / Math.sqrt(norm2) : 1;

    const dx = math.multiply(K, innov);
    this.x = math.add(this.x, math.multiply(wt, dx));

    const I = math.identity(4) as math.Matrix;
    this.P = math.multiply(math.subtract(I, math.multiply(K, H)), this.P);

    this.x.set([2,0], ((this.x.get([2,0]) + Math.PI) % (2*Math.PI)) - Math.PI);
    this.x.set([3,0], Math.max(0, Math.min(this.MAX_SPEED, this.x.get([3,0]))));
  }

  getHeading(): number { let h = this.x.get([2,0]); return ((h + Math.PI) % (2*Math.PI)) - Math.PI; }
  getHeadingDeg(): number { return (this.getHeading() * 180 / Math.PI + 360) % 360; }
  getSpeed(): number { return this.x.get([3,0]); }
  getSpeedKmh(): number { return this.getSpeed() * 3.6; }
  getState(): EKFState { return {lat:this.x.get([0,0]), lon:this.x.get([1,0]), headingRad:this.getHeading(), speedMps:this.getSpeed()}; }
}