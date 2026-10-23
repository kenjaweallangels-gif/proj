import * as THREE from 'three';
import { STAR_VERTEX, STAR_FRAGMENT, MILKYWAY_VERTEX, MILKYWAY_FRAGMENT } from './shaders/SkyShaders.js';
import { bvToLinearRgb } from './StarColor.js';

/**
 * FAR scene sky: 41 411 catalogue stars (public/data/stars.bin) as Points with magnitude-driven size and
 * brightness and B-V colours, plus the Milky Way as an equirect-mapped BackSide sphere. Both live in a
 * Group whose quaternion is ctx.orbit.skyQuat (ECI -> LVLH).  setExposure(x) scales both.
 */

const STAR_DISTANCE_KM = 1.5e6;
const MILKYWAY_RADIUS_KM = 1.4e6;

export class Sky {
  constructor(ctx) {
    this.ctx = ctx;
    this.group = new THREE.Group();
    this.group.name = 'Sky';
    this.exposure = 1.0;                      // user / fx exposure (setExposure)
    this.adapt = 1.0;                         // automatic adaptation: the sky fades when the Sun is up (sunlit-Earth exposure)
    this.uExposure = { value: 1.0 };
    this.uPixelRatio = { value: ctx.renderer.getPixelRatio() };
    this.uSizeScale = { value: 1.0 };

    this.starMaterial = new THREE.ShaderMaterial({
      name: 'Stars',
      uniforms: { uPixelRatio: this.uPixelRatio, uExposure: this.uExposure, uSizeScale: this.uSizeScale },
      vertexShader: STAR_VERTEX, fragmentShader: STAR_FRAGMENT,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: true, toneMapped: false,
    });
    this.stars = null;      // created in load()

    this.milkyWayMaterial = new THREE.ShaderMaterial({
      name: 'MilkyWay',
      uniforms: { uMap: { value: null }, uIntensity: { value: 0.09 }, uExposure: this.uExposure },
      vertexShader: MILKYWAY_VERTEX, fragmentShader: MILKYWAY_FRAGMENT,
      side: THREE.BackSide, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: true, toneMapped: false,
    });
    this.milkyWay = new THREE.Mesh(new THREE.SphereGeometry(MILKYWAY_RADIUS_KM, 48, 24), this.milkyWayMaterial);
    this.milkyWay.name = 'MilkyWay';
    this.milkyWay.renderOrder = -30;
    this.milkyWay.frustumCulled = false;
    this.milkyWay.visible = false;
    this.group.add(this.milkyWay);

    ctx.farScene.add(this.group);
    this.group.quaternion.copy(ctx.orbit.skyQuat);
    this._size = new THREE.Vector2();
  }

  async load() {
    const ctx = this.ctx;
    const [buf, tex] = await Promise.all([
      fetch(ctx.assetUrl('data/stars.bin')).then((r) => { if (!r.ok) throw new Error(`stars.bin HTTP ${r.status}`); return r.arrayBuffer(); }),
      new THREE.TextureLoader().loadAsync(ctx.assetUrl('textures/sky/milkyway_2048.png')),
    ]);
    this._buildStars(buf);
    tex.colorSpace = THREE.NoColorSpace;
    tex.flipY = false;                       // v = 0 is the top row (north) as in the equirect convention
    tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.generateMipmaps = false; tex.minFilter = THREE.LinearFilter; tex.magFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    this.milkyWayMaterial.uniforms.uMap.value = tex;
    this.milkyWayTexture = tex;
    this.milkyWay.visible = true;
  }

  /** stars.bin: little-endian uint32 N, then N x float32 [ra_deg, dec_deg, mag, bv]. */
  _buildStars(buf) {
    const view = new DataView(buf);
    const n = view.getUint32(0, true);
    const data = new Float32Array(buf, 4, n * 4);
    const pos = new Float32Array(n * 3), mag = new Float32Array(n), col = new Float32Array(n * 3);
    const D = Math.PI / 180;
    const rgb = [0, 0, 0];
    for (let i = 0; i < n; i++) {
      const ra = data[i * 4] * D, dec = data[i * 4 + 1] * D;
      const cd = Math.cos(dec);
      pos[i * 3] = cd * Math.cos(ra) * STAR_DISTANCE_KM;
      pos[i * 3 + 1] = cd * Math.sin(ra) * STAR_DISTANCE_KM;
      pos[i * 3 + 2] = Math.sin(dec) * STAR_DISTANCE_KM;
      mag[i] = data[i * 4 + 2];
      bvToLinearRgb(data[i * 4 + 3], rgb);
      col[i * 3] = rgb[0]; col[i * 3 + 1] = rgb[1]; col[i * 3 + 2] = rgb[2];
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aMag', new THREE.BufferAttribute(mag, 1));
    geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), STAR_DISTANCE_KM * 1.01);
    this.stars = new THREE.Points(geo, this.starMaterial);
    this.stars.name = 'Stars';
    this.stars.renderOrder = -20;
    this.stars.frustumCulled = false;
    this.starCount = n;
    this.group.add(this.stars);
  }

  /** Global brightness multiplier for stars and Milky Way (default 1); multiplied by the automatic day/night adaptation. */
  setExposure(x) { this.exposure = Math.max(0, x); this.uExposure.value = this.exposure * this.adapt; }

  update(dt, ctx) {
    const o = ctx.orbit;
    this.group.quaternion.copy(o.skyQuat);
    // Day/night adaptation: with the Sun up the camera exposes for the sunlit Earth and only bright stars remain;
    // in eclipse the full sky (faint stars, Milky Way) comes out. Eased over a few seconds, instant on the first frame.
    const target = 1.0 - 0.7 * o.sunVisible * (0.5 + 0.5 * o.earthLit);
    if (this._first === undefined) { this._first = false; this.adapt = target; }
    else this.adapt += (target - this.adapt) * (1 - Math.exp(-Math.max(dt, 0) / 3.0));
    this.uExposure.value = this.exposure * this.adapt;
    const r = ctx.renderer;
    this.uPixelRatio.value = r.getPixelRatio();
    r.getSize(this._size);
    // keep the apparent star size similar across window sizes (reference: 900 px tall viewport)
    this.uSizeScale.value = Math.min(1.5, Math.max(0.75, this._size.y / 900));
  }

  dispose() {
    this.ctx.farScene.remove(this.group);
    this.stars?.geometry.dispose();
    this.starMaterial.dispose();
    this.milkyWay.geometry.dispose();
    this.milkyWayMaterial.dispose();
    this.milkyWayTexture?.dispose();
  }
}
