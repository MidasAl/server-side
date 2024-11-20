const { Configuration, OpenAIApi } = require('openai');
const logger = require('../config/logger');
require('dotenv').config();

const configuration = new Configuration({
    apiKey: process.env.OPENAI_API_KEY
});

const client = new OpenAIApi(configuration);

async function analyzeWithLLM(content, is_image = false) {
    try {
        const messages = [
            {
                role: "system",
                content: (
                    "You are an assistant helping with reimbursement requests. " +
                    "Analyze the receipt image and decide whether to 'Approve' or 'Reject' the request. " +
                    "Do not consider the dates or any date-related information when processing your decision. " +
                    "Focus solely on the content provided. " +
                    "Please respond in the following format:\n\n" +
                    "Decision: [Approve/Reject]\n" +
                    "Feedback: [Your explanation here]\n\n" +
                    "Please avoid using ambiguous language that might put the decision in doubt."
                )
            },
            {
                role: "user",
                content: is_image 
                    ? `Please analyze this receipt image in base64 format:\n\n${content}`
                    : `Here is the document content:\n\n${content}`
            }
        ];
        
        const response = await client.createChatCompletion({
            model: "gpt-4o-mini",
            messages: messages
        });
        
        const analysis = response.data.choices[0].message.content;
        const lines = analysis.trim().split('\n');
        let decision = null;
        const feedback_lines = [];

        for (const line of lines) {
            if (line.toLowerCase().startsWith("decision:")) {
                decision = line.substring("Decision:".length).trim();
            } else if (line.toLowerCase().startsWith("feedback:")) {
                feedback_lines.push(line.substring("Feedback:".length).trim());
            } else {
                feedback_lines.push(line.trim());
            }
        }

        if (!['Approve', 'Reject'].includes(decision)) {
            decision = 'Rejected';
        }

        return {
            decision: decision,
            feedback: feedback_lines.join('\n')
        };
    } catch (e) {
        logger.error(`Error analyzing content: ${e.message}`);
        throw new Error(`Error analyzing content: ${e.message}`);
    }
}

module.exports = {
    analyzeWithLLM
};