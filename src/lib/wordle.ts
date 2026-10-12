export type Feedback = "correct" | "present" | "absent";

/** Klassischer Zwei-Pass-Vergleich, behandelt doppelte Buchstaben korrekt. */
export function evaluateGuess(guess: string, answer: string): Feedback[] {
  const result: Feedback[] = new Array(answer.length).fill("absent");
  const answerLetters: (string | null)[] = answer.split("");
  const guessLetters: (string | null)[] = guess.split("");

  for (let i = 0; i < answer.length; i++) {
    if (guessLetters[i] === answerLetters[i]) {
      result[i] = "correct";
      answerLetters[i] = null;
      guessLetters[i] = null;
    }
  }
  for (let i = 0; i < answer.length; i++) {
    if (guessLetters[i] === null) continue;
    const idx = answerLetters.indexOf(guessLetters[i]);
    if (idx !== -1) {
      result[i] = "present";
      answerLetters[idx] = null;
    }
  }
  return result;
}
