/* Pure Nova Blast zone predicate (no THREE, no DOM).
   dz = obj.z - player.z; forward is negative z, so the zone reaches
   NOVA_RADIUS units ahead and NOVA_BLAST_FORWARD units behind the player. */
import { NOVA_RADIUS, NOVA_BLAST_FORWARD } from "../config";

export function isInNovaZone(radial: number, dz: number): boolean {
  return radial <= NOVA_RADIUS && dz <= NOVA_BLAST_FORWARD && dz >= -NOVA_RADIUS;
}
