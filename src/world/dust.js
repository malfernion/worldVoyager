// Draws the buggy dust pool (#26, src/physics/dust.js): two instanced billboard meshes, the
// same kind as the ambient puffs, so two draw calls however much dust there is. Dust is lit
// by the sun like the ground it came from; the Hopper's flames are an unlit, additive glow.
// The meshes live in the world's group (the pool is in the world's own frame, like the buggy).
import { billboards } from './ambient.js';
import { glowTexture, puffTexture } from './materials.js';
import { DUST_KIND } from '../physics/dust.js';

export function createDustMesh(pool, sunDir, radius) {
  const dust = billboards(pool.capacity, puffTexture(), sunDir, radius * 1.5);
  const flame = billboards(pool.capacity, glowTexture('rgba(255,236,190,1)', 'rgba(255,120,40,0)'), sunDir, radius * 1.5, { additive: true, lit: false });
  // Drawn after the planet and its ambient puffs, so the dust sits on top of the ground's.
  dust.mesh.renderOrder = flame.mesh.renderOrder = 2;
  const col = { r: 1, g: 1, b: 1 };
  return {
    meshes: [dust.mesh, flame.mesh],
    /** Move into a world's group, lit by its sun. */
    attach(group, dir, r) {
      for (const m of [dust.mesh, flame.mesh]) {
        group.add(m);
        m.material.uniforms.sunDir.value = dir;
        m.geometry.boundingSphere.radius = r * 1.5;
      }
    },
    /** Copy the live particles into the two meshes (instanceCount is only what's live). */
    update() {
      let nd = 0, nf = 0;
      const p = pool.pos, c = pool.col;
      for (let n = 0; n < pool.count; n++) {
        const i = pool.live[n];
        col.r = c[i * 3]; col.g = c[i * 3 + 1]; col.b = c[i * 3 + 2];
        const to = pool.kind[i] === DUST_KIND ? dust : flame;
        const k = to === dust ? nd++ : nf++;
        to.set(k, p[i * 3], p[i * 3 + 1], p[i * 3 + 2], pool.sizeOf(i), pool.spin[i] + pool.age[i] * 0.8, col, pool.alphaOf(i));
      }
      dust.mesh.geometry.instanceCount = nd;
      flame.mesh.geometry.instanceCount = nf;
      dust.mesh.visible = nd > 0;
      flame.mesh.visible = nf > 0;
      dust.commit();
      flame.commit();
    },
  };
}
