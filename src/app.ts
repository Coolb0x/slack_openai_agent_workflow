import { fileSearchTool, webSearchTool, Agent, AgentInputItem, Runner, withTrace, run } from "@openai/agents";
import { z } from "zod";
import { classifyInstructions } from "./instructions.js";
// import express from "express";
import dotenv from "dotenv";

import path from "path";
import { fileURLToPath } from "url";

// Get directory name in ESM module
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Point to .env file in the root directory (one level up from src)
dotenv.config({ path: path.resolve(__dirname, "../.env") });

if (!process.env.OPENAI_API_KEY) {
  throw new Error("Missing OpenAI API key in .env file");
}

// Tool definitions
const fileSearch = fileSearchTool(["vs_680dee6c695c819184a4e74dbe689259"]);
const webSearchPreview = webSearchTool({
  searchContextSize: "medium",
  userLocation: {
    type: "approximate",
  },
});

// Classify definitions
const ClassifySchema = z.object({ category: z.enum(["Search in KB", "Polish Reply", "General Assistan"]) });
const classify = new Agent({
  name: "Classify",
  instructions: classifyInstructions,
  model: "gpt-5.2",
  outputType: ClassifySchema,
  modelSettings: {
    temperature: 0,
  },
});
const searchThroughKb = new Agent({
  name: "Search Through KB ",
  instructions: `Use the knowledge from the provided  files to accurately answer user queries.

When a query is presented:
1. Search through the file(s) for relevant information related to the query.
2. Extract key details and relevant sections to understand the context fully.
3. Formulate an accurate and concise response based on the extracted information.

# Steps

1. **Query Analysis**: Understand the user's question to identify keywords and concepts.
2. **Search for Information**: Locate sections in the provided files that are relevant to the query.
3. **Extract Key Information**: Identify critical facts, figures, or statements that directly address the query.
4. **Formulate Response**: Use the extracted information to create a coherent and direct answer.
5. **Review and Adjust**: Ensure the response fully addresses the query and contains accurate information.

# Output Format

- Provide a concise and direct answer, formatted as a paragraph.

# Examples

**Example**

**Query**: “What is the price and what are all the steps to restore a terminated GrowBig account\"

**Response**: \"To restore a terminated GrowBig account, you should follow these steps:
1. Verify Account Status: Check if the account has indeed been terminated by navigating to the Client Manager in your MACO system.
2. Check for Backups: If the account has been terminated, determine if there are any backups available. Backups are generally retained for up to 60 days post-termination for shared accounts. You can check for backups using the backup tool provided.
3. Calculate Restoration Fees: If a backup is available, inform the customer about the restoration fee, which is $65.00 USD/€60.00 EUR/£50.00 GBP/AU$100.00 (equal to 1 Support Credit) plus the renewal fee for the desired period. For restoring multiple websites (up to 5), only one restore fee is charged.
4. Generate Payment Link: Once you have confirmation from the client, use the Order tool to create a payment link that includes both the hosting package renewal and the restore fee. Ensure that the payment link clearly shows both items.
5. Submit a Support Ticket: After the payment is confirmed, submit a support ticket on behalf of the customer detailing the restoration request.
6. Confirm Restoration: After the ticket is submitted, the technical team will assist in restoring the account from the most recent backup available.
If there are no backups available, unfortunately, the data is irrecoverable, and the client will need to purchase a new hosting plan”

# Notes

- Pay attention to potential variations in terminology between the user's query and the files.
- Ensure that the response is self-contained and does not require further clarification or outside knowledge.
- Always verify the accuracy of the response against the latest version of the files provided.
`,
  model: "gpt-5.2",
  tools: [fileSearch],
  modelSettings: {
    reasoning: {
      effort: "medium",
      summary: "auto",
    },
    store: true,
  },
});

const polishReplyAgent = new Agent({
  name: "Polish Reply Agent",
  instructions:
    "In most cases you will receive a reply that is for a chat or a ticket and you should re-write it and make it friendly, compassionate and empathetic as for a customer.",
  model: "gpt-5.2",
  modelSettings: {
    reasoning: {
      effort: "medium",
      summary: "auto",
    },
    store: true,
  },
});

const generalAgent = new Agent({
  name: "General Agent",
  instructions: "You are a general assistant to help with all sorts of requests",
  model: "gpt-5.2",
  tools: [webSearchPreview],
  modelSettings: {
    reasoning: {
      effort: "low",
      summary: "auto",
    },
    store: true,
  },
});

type WorkflowInput = { input_as_text: string };

// Main code entrypoint
export const runWorkflow = async (workflow: WorkflowInput) => {
  return await withTrace("Customer Success Slack Agent", async () => {
    const state = {};
    const conversationHistory: AgentInputItem[] = [
      { role: "user", content: [{ type: "input_text", text: workflow.input_as_text }] },
    ];
    const runner = new Runner({
      traceMetadata: {
        __trace_source__: "agent-builder",
        workflow_id: "wf_697bb6bed81c81909e7c12d226f40ae604f79fa58b664557",
      },
    });
    const classifyInput = workflow.input_as_text;
    const classifyResultTemp = await runner.run(classify, [
      { role: "user", content: [{ type: "input_text", text: `${classifyInput}` }] },
    ]);

    if (!classifyResultTemp.finalOutput) {
      throw new Error("Agent result is undefined");
    }

    const classifyResult = {
      output_text: JSON.stringify(classifyResultTemp.finalOutput),
      output_parsed: classifyResultTemp.finalOutput,
    };
    const classifyCategory = classifyResult.output_parsed.category;
    const classifyOutput = { category: classifyCategory };
    if (classifyCategory == "Search in KB") {
      const searchThroughKbResultTemp = await runner.run(searchThroughKb, [...conversationHistory]);
      conversationHistory.push(...searchThroughKbResultTemp.newItems.map(item => item.rawItem));

      if (!searchThroughKbResultTemp.finalOutput) {
        throw new Error("Agent result is undefined");
      }

      return {
        output_text: searchThroughKbResultTemp.finalOutput ?? "",
      };
    } else if (classifyCategory == "Polish Reply") {
      const polishReplyAgentResultTemp = await runner.run(polishReplyAgent, [...conversationHistory]);
      conversationHistory.push(...polishReplyAgentResultTemp.newItems.map(item => item.rawItem));

      if (!polishReplyAgentResultTemp.finalOutput) {
        throw new Error("Agent result is undefined");
      }

      return {
        output_text: polishReplyAgentResultTemp.finalOutput ?? "",
      };
    } else {
      const generalAgentResultTemp = await runner.run(generalAgent, [...conversationHistory]);
      conversationHistory.push(...generalAgentResultTemp.newItems.map(item => item.rawItem));

      if (!generalAgentResultTemp.finalOutput) {
        throw new Error("Agent result is undefined");
      }

      return {
        output_text: generalAgentResultTemp.finalOutput ?? "",
      };
    }
  });
};

// const app = express();
// app.post('/slack-webhook', async (req, res) => {
//   const result = await runWorkflow({ input_as_text: req.body.text });
//   res.json(result);
// });
// app.listen(3000, () => console.log('Server running on port 3000'));

async function main() {
  const result = await runWorkflow({ input_as_text: "how to provide a custom payment link" });
  console.log(result);
}

main().catch(console.error);

// const agent = new Agent({
//   name: "Assistant",
//   instructions: "You are a helpful assistant",
// });

// const result = await run(agent, "Write hello api is working.");
// console.log(result.finalOutput);
