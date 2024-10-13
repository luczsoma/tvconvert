import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";

export async function question(question: string): Promise<string> {
  const readLineInterface = createInterface({
    input: stdin,
    output: stdout,
  });
  const answer = await readLineInterface.question(question);
  readLineInterface.close();
  return answer;
}
