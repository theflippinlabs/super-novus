/* CameraController — ported verbatim from reference/supernova.html (validated build).
   GOLDEN RULE: behavior and visuals must remain identical. */
import * as THREE from "three";
import { rand, clamp, reduceMotion } from "./util";
import { CFG } from "./legacyCfg";

export class CameraController {
  [key: string]: any;
  constructor(camera){ this.cam = camera; this.baseFov = 84; }
  update(dt, player, speed, game){
    const cf = 1 - Math.exp(-13*dt);
    const camX = player.pos.x*0.55;
    const camY = player.pos.y*0.55 + 2.1;
    this.cam.position.x += (camX - this.cam.position.x)*cf;
    this.cam.position.y += (camY - this.cam.position.y)*cf;
    this.cam.position.z = player.pos.z + 8.6;
    if (game.shake > 0){
      game.shake -= dt*1.7;
      const s = Math.max(0, game.shake)*0.55;
      this.cam.position.x += rand(-s, s);
      this.cam.position.y += rand(-s, s);
    }
    this.cam.lookAt(player.pos.x*0.92, player.pos.y*0.92, player.pos.z - 22);
    const wantFov = 84 + (speed - CFG.baseSpeed)*0.15;
    // Smooth the speed-driven FOV, then add the transient Nova Blast punch on
    // top so the punch never persists in the camera's own state. With no punch
    // (fovPunch = 0) this is identical to the validated single-lerp behaviour.
    this.baseFov += (wantFov - this.baseFov)*cf;
    this.cam.fov = this.baseFov + (game.fovPunch || 0);
    this.cam.updateProjectionMatrix();
    if (!reduceMotion && speed > 90 && game.running){
      this.cam.position.x += (Math.random()-0.5)*0.035;
      this.cam.position.y += (Math.random()-0.5)*0.035;
    }
  }
}
