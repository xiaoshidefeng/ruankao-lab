/* 论文题集加载：正式题集 essays.json 不入仓库（同题库的版权策略，gitignore）；
   存在则优先，否则回落自创示例题集 essays.sample.json。 */
import type { EssayTopic } from "./types";

const mods = import.meta.glob<{ default: { topics: EssayTopic[] } }>("../data/essay*.json", { eager: true });
const pick = (file: string) => Object.entries(mods).find(([path]) => path.endsWith(file))?.[1];

export const essayTopics: EssayTopic[] = (pick("data/essays.json") ?? pick("data/essays.sample.json"))!.default.topics;
export const essayTopicById = new Map<string, EssayTopic>(essayTopics.map((t) => [t.id, t]));
