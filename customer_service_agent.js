import { ChatOpenAI } from "@langchain/openai";
import { InMemoryChatMessageHistory } from "@langchain/core/chat_history";
import { HumanMessage, SystemMessage, AIMessage } from "@langchain/core/messages";
import pdf from "pdf-parse";
import { readFile } from "fs/promises";
import { existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import readline from "readline";

import dotenv from "dotenv";
if (existsSync(".env")) {
  dotenv.config();
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

class LunaGlowCustomerServiceAgent {
  constructor({
    pdfPath = "LunaGlow.pdf",
    azureEndpoint = null,
    azureDeployment = null,
    apiVersion = null,
    apiKey = null,
  } = {}) {
    this.pdfPath = pdfPath;
    this.azureEndpoint =
      azureEndpoint ||
      process.env.AZURE_OPENAI_ENDPOINT ||
      process.env.AZURE_ENDPOINT;
    this.azureDeployment =
      azureDeployment ||
      process.env.AZURE_OPENAI_DEPLOYMENT ||
      process.env.AZURE_DEPLOYMENT ||
      "gpt-4o-mini";
    this.apiVersion =
      apiVersion ||
      process.env.AZURE_OPENAI_API_VERSION ||
      process.env.AZURE_API_VERSION ||
      "2024-12-01-preview";
    this.apiKey =
      apiKey ||
      process.env.AZURE_OPENAI_API_KEY ||
      process.env.AZURE_API_KEY;

    if (this.azureEndpoint) {
      this.azureEndpoint = this.azureEndpoint.replace(/\/$/, "");
    }

    if (!this.azureEndpoint || !this.apiKey) {
      throw new Error(
        "Azure OpenAI configuration incomplete. " +
          "Please define AZURE_OPENAI_ENDPOINT and " +
          "AZURE_OPENAI_API_KEY (or AZURE_API_KEY) in a .env file or pass them as parameters."
      );
    }

    try {
      const endpointUrl = new URL(this.azureEndpoint);
      const instanceName = endpointUrl.hostname.split(".")[0];

      this.llm = new ChatOpenAI({
        azureOpenAIApiKey: this.apiKey,
        azureOpenAIApiInstanceName: instanceName,
        azureOpenAIApiDeploymentName: this.azureDeployment,
        azureOpenAIApiVersion: this.apiVersion,
        temperature: 0.7,
      });
    } catch (error) {
      throw new Error(
        `Error initializing Azure OpenAI model: ${error.message}\n` +
          `Please verify that the deployment '${this.azureDeployment}' exists in your Azure OpenAI resource.\n` +
          `Endpoint: ${this.azureEndpoint}\n` +
          `You can create a deployment in the Azure OpenAI portal.`
      );
    }

    this.memory = new InMemoryChatMessageHistory();
    this.systemMessage = null;
    this.pdfContent = null;
  }

  async _loadPdf() {
    // Try multiple paths to find the PDF, as Vercel's working directory can vary
    const possiblePaths = [
      // 1. From process.cwd() (project root)
      join(process.cwd(), this.pdfPath),
      // 2. From __dirname (where this file is located) - go up to project root
      join(__dirname, "..", this.pdfPath),
      // 3. From __dirname directly (if PDF is in same directory)
      join(__dirname, this.pdfPath),
      // 4. Absolute path from __dirname going up two levels (for api/ structure)
      join(__dirname, "..", "..", this.pdfPath),
    ];

    console.log(`Attempting to load PDF from possible paths:`);
    for (const path of possiblePaths) {
      console.log(`  - ${path}`);
    }

    for (const fullPath of possiblePaths) {
      try {
        if (existsSync(fullPath)) {
          console.log(`✓ Found PDF at: ${fullPath}`);
          const dataBuffer = await readFile(fullPath);
          const data = await pdf(dataBuffer);
          const pdfText = data.text;
          console.log(`PDF loaded: ${pdfText.length} characters extracted`);
          return pdfText;
        }
      } catch (error) {
        // Continue to next path
        console.log(`  ✗ Failed to load from ${fullPath}: ${error.message}`);
      }
    }

    // If we get here, none of the paths worked
    console.error(`Error: Unable to load PDF from any of the attempted paths`);
    console.error(`Current working directory: ${process.cwd()}`);
    console.error(`__dirname: ${__dirname}`);
    return "Error: Unable to load PDF.";
  }

  async initialize() {
    this.pdfContent = await this._loadPdf();

    const systemMessageContent = `You are a professional and friendly customer service agent for LunaGlow, a French natural and ethical cosmetics brand.

Here is the information about LunaGlow extracted from our documentation:

${this.pdfContent}

Answer customer questions clearly, concisely and helpfully based solely on the information above. If you don't know the answer, say so politely and suggest contacting customer service directly.`;

    this.systemMessage = new SystemMessage({ content: systemMessageContent });
  }

  async ask(question) {
    const messages = [this.systemMessage];
    const historyMessages = await this.memory.getMessages();
    messages.push(...historyMessages);
    messages.push(new HumanMessage({ content: question }));

    const response = await this.llm.invoke(messages);

    await this.memory.addMessage(new HumanMessage({ content: question }));
    await this.memory.addMessage(new AIMessage({ content: response.content }));

    return {
      answer: response.content,
    };
  }

  async chat() {
    console.log("\n" + "=".repeat(60));
    console.log("LunaGlow Customer Service Agent");
    console.log("=".repeat(60));
    console.log("Hello! I am your LunaGlow assistant. How can I help you?");
    console.log("Type 'quit' or 'exit' to quit.\n");

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const askQuestion = () => {
      return new Promise((resolve) => {
        rl.question("You: ", (answer) => {
          resolve(answer);
        });
      });
    };

    while (true) {
      const question = (await askQuestion()).trim();

      if (question.toLowerCase() === "quit" || question.toLowerCase() === "exit" || question.toLowerCase() === "q") {
        console.log("\nThank you for contacting LunaGlow. See you soon!");
        rl.close();
        break;
      }

      if (!question) {
        continue;
      }

      try {
        const result = await this.ask(question);
        console.log(`\nAgent: ${result.answer}\n`);
      } catch (error) {
        console.error(`\nError: ${error.message}\n`);
      }
    }
  }
}

async function main() {
  try {
    const agent = new LunaGlowCustomerServiceAgent();
    await agent.initialize();
    await agent.chat();
  } catch (error) {
    if (error.message.includes("configuration")) {
      console.error(`Configuration error: ${error.message}`);
      console.log("\nTo use this agent, you must:");
      console.log("1. Create a .env file at the project root");
      console.log("2. Add Azure OpenAI variables:");
      console.log("   AZURE_OPENAI_ENDPOINT=https://your-resource.cognitiveservices.azure.com/");
      console.log("   AZURE_OPENAI_API_KEY=your_api_key");
      console.log("   AZURE_OPENAI_DEPLOYMENT=gpt-4o-mini (or your deployment)");
      console.log("   AZURE_OPENAI_API_VERSION=2024-12-01-preview (optional)");
    } else {
      console.error(`Error: ${error.message}`);
    }
    process.exit(1);
  }
}

if (import.meta.main) {
  main();
}

export { LunaGlowCustomerServiceAgent };

