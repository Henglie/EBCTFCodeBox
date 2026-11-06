import { register } from "./registry.js";
import { TEXT_UTILS_OPS } from "./textUtils.js";

for (const op of TEXT_UTILS_OPS) register(op);
