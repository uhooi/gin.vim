import { Denops, unknownutil } from "../../deps.ts";
import * as registry from "./registry.ts";
import * as action from "./action.ts";

export function main(denops: Denops): void {
  denops.dispatcher = {
    ...denops.dispatcher,
    "action:list_actions": () => {
      return action.list(denops);
    },
    "action:gather_candidates": (range) => {
      unknownutil.assertLike([0, 0] as [number, number], range);
      return registry.gatherCandidates(denops, range);
    },
    "action:action:choice": (range) => {
      unknownutil.assertLike([0, 0] as [number, number], range);
      return action.actionChoice(denops, range);
    },
    "action:action:repeat": (range) => {
      unknownutil.assertLike([0, 0] as [number, number], range);
      return action.actionRepeat(denops, range);
    },
    "action:action:help": (range, reduced) => {
      unknownutil.assertLike([0, 0] as [number, number], range);
      unknownutil.assertBoolean(reduced);
      return action.actionHelp(denops, range, reduced);
    },
  };
}
