import type { AiReference } from './ai';
export interface AiTurn {
  id: string;
  question: string;
  answer: string;
  revision: number;
  model: string;
  createdAt: string;
  references: AiReference[];
  error?: string;
}
/** Session memory only: no source, prompts or replies are written to workspace storage. */
export class ConversationStore {
  private regions = new Map<string, AiTurn[]>();
  get(key: string) {
    return this.regions.get(key) ?? [];
  }
  add(key: string, turn: AiTurn) {
    const turns = [...this.get(key).filter((t) => t.id !== turn.id), turn].slice(-8);
    while (
      turns.length > 1 &&
      turns.reduce((sum, t) => sum + t.answer.length + t.question.length, 0) > 300000
    ) {
      turns.shift();
    }
    this.regions.delete(key);
    this.regions.set(key, turns);
    while (this.regions.size > 8) {
      this.regions.delete(this.regions.keys().next().value!);
    }
  }
  clear(key: string) {
    this.regions.delete(key);
  }
  has(id: string) {
    return [...this.regions.values()].some((turns) => turns.some((t) => t.id === id));
  }
}
