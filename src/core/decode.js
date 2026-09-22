// Answers -> one decision the executor can run, with a probability behind every
// part. Only the target head of the winning operation is read; the others were
// speculative. Anything outside the offered options is rejected, never guessed.
import { NOT_STATED, TARGET_QID } from "./questions.js";

export class InvalidAnswer extends Error {}

function checked(answer, keys) {
  const probabilities = answer?.probabilities;
  const ok =
    answer &&
    keys.includes(answer.choice) &&
    probabilities &&
    Object.values(probabilities).every((p) => Number.isFinite(p) && p >= 0 && p <= 1) &&
    Math.abs(Object.values(probabilities).reduce((a, b) => a + b, 0) - 1) < 0.02;
  if (!ok) throw new InvalidAnswer("Jev returned an answer outside the offered options; nothing was executed.");
  return answer;
}

const top = (probabilities, n = 3) =>
  Object.entries(probabilities)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([value, probability]) => ({ value, probability }));

export function decode(plan, answers) {
  const operation = checked(answers.operation, Object.keys(plan.ops));
  const op = operation.choice;
  const decision = { op, probability: operation.probabilities[op], alternatives: top(operation.probabilities) };
  const parts = [decision.probability];

  const targets = plan.targets[op];
  if (targets) {
    const answer = checked(answers[TARGET_QID[op]], Object.keys(targets));
    decision.index = answer.choice;
    decision.target = targets[answer.choice];
    decision.targetProbability = answer.probabilities[answer.choice];
    decision.targetAlternatives = top(answer.probabilities);
    parts.push(decision.targetProbability);
  }

  if (op === "TYPE" || op === "TYPE_SUBMIT") {
    const head = plan.text[decision.index];
    const answer = head ? answers[head.qid] : null;
    decision.text = null;
    if (answer) {
      checked(answer, [...Object.keys(head.values), NOT_STATED]);
      decision.textAlternatives = top(answer.probabilities);
      if (answer.choice !== NOT_STATED) {
        decision.text = head.values[answer.choice];
        decision.textProbability = answer.probabilities[answer.choice];
        parts.push(decision.textProbability);
      }
    }
  }

  // One wrong part spoils the step, so the step is as sure as its least sure part.
  decision.confidence = Math.min(...parts);
  decision.singleStep = answers.single_step?.noul ?? 0;
  return decision;
}
