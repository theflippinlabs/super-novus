/* CameraController — ported verbatim from reference/supernova.html (validated build).
   GOLDEN RULE: behavior and visuals must remain identical. */
import * as THREE from "three";
import { rand, clamp, reduceMotion } from "./util";
import { CFG } from "./legacyCfg";

export class CameraController {
  [key: string]: any;
  constructor(camera){ this.cam = camera; }
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
    this.cam.fov += (wantFov - this.cam.fov)*cf;
    this.cam.updateProjectionMatrix();
    if (!reduceMotion && speed > 90 && game.running){
      this.cam.position.x += (Math.random()-0.5)*0.035;
      this.cam.position.y += (Math.random()-0.5)*0.035;
    }
  }
}
