/** Runtime mirror of the stable character-card directory supplied by Operit. */
import type { DataActor } from "./model";
import { DEFAULT_ACTORS } from "./seed";

export class HostActorDirectory {
  private actors: DataActor[];
  constructor(actors: DataActor[] = DEFAULT_ACTORS) {
    this.actors = actors.map((actor) => ({ ...actor }));
  }

  replaceCharacters(actors: readonly DataActor[]): void {
    const seen = new Set<string>();
    const next: DataActor[] = [];
    for (const actor of actors) {
      if (actor.characterId.trim().length === 0) {
        throw new Error("MVU_ACTOR_ID_EMPTY");
      }
      if (seen.has(actor.characterId)) {
        throw new Error(`MVU_ACTOR_ID_DUPLICATE:${actor.characterId}`);
      }
      seen.add(actor.characterId);
      next.push({ ...actor });
    }
    this.actors = next;
  }

  async listCharacters(): Promise<DataActor[]> {
    return this.actors.map((actor) => ({ ...actor }));
  }
}
