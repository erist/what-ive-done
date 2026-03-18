import { createInterface } from "node:readline/promises";
import type { Interface as ReadlineInterface } from "node:readline/promises";

export function isInteractiveTerminal(
  input: NodeJS.ReadStream = process.stdin,
  output: NodeJS.WriteStream = process.stdout,
): boolean {
  return Boolean(input.isTTY && output.isTTY);
}

export class PromptSession {
  private readonly readline: ReadlineInterface;

  constructor(
    private readonly input: NodeJS.ReadStream = process.stdin,
    private readonly output: NodeJS.WriteStream = process.stdout,
  ) {
    this.readline = createInterface({
      input: this.input,
      output: this.output,
    });
  }

  async text(question: string, defaultValue?: string): Promise<string> {
    const prompt = defaultValue === undefined
      ? `${question}: `
      : `${question} [${defaultValue}]: `;
    const answer = (await this.readline.question(prompt)).trim();

    if (answer.length > 0) {
      return answer;
    }

    return defaultValue ?? "";
  }

  async confirm(question: string, defaultValue: boolean): Promise<boolean> {
    const suffix = defaultValue ? "Y/n" : "y/N";

    while (true) {
      const answer = (await this.readline.question(`${question} (${suffix}): `)).trim().toLowerCase();

      if (answer.length === 0) {
        return defaultValue;
      }

      if (answer === "y" || answer === "yes") {
        return true;
      }

      if (answer === "n" || answer === "no") {
        return false;
      }
    }
  }

  async select(question: string, options: string[], defaultIndex = 0): Promise<string> {
    this.output.write(`${question}\n`);

    options.forEach((option, index) => {
      const marker = index === defaultIndex ? "*" : " ";
      this.output.write(`  ${marker} ${index + 1}. ${option}\n`);
    });

    while (true) {
      const answer = (await this.readline.question(`Choose [${defaultIndex + 1}]: `)).trim();

      if (answer.length === 0) {
        return options[defaultIndex] ?? "";
      }

      const selectedIndex = Number.parseInt(answer, 10) - 1;

      if (Number.isInteger(selectedIndex) && selectedIndex >= 0 && selectedIndex < options.length) {
        return options[selectedIndex] ?? "";
      }

      const matched = options.find((option) => option.toLowerCase() === answer.toLowerCase());

      if (matched) {
        return matched;
      }
    }
  }

  async secret(question: string, defaultValue?: string): Promise<string> {
    if (!this.input.isTTY || !this.output.isTTY || typeof this.input.setRawMode !== "function") {
      return this.text(question, defaultValue);
    }

    const prompt = defaultValue === undefined
      ? `${question}: `
      : `${question} [hidden]: `;

    this.output.write(prompt);

    return await new Promise<string>((resolve, reject) => {
      let value = "";

      const cleanup = () => {
        this.input.off("data", onData);
        this.input.setRawMode(false);
        this.input.pause();
      };

      const onData = (chunk: string | Buffer) => {
        const text = chunk.toString("utf8");

        for (const character of text) {
          if (character === "\u0003") {
            cleanup();
            reject(new Error("Interactive input cancelled"));
            return;
          }

          if (character === "\r" || character === "\n") {
            this.output.write("\n");
            cleanup();
            resolve(value.length > 0 ? value : (defaultValue ?? ""));
            return;
          }

          if (character === "\u007f" || character === "\b") {
            value = value.slice(0, -1);
            continue;
          }

          value += character;
        }
      };

      this.input.setRawMode(true);
      this.input.resume();
      this.input.on("data", onData);
    });
  }

  close(): void {
    this.readline.close();
  }
}
