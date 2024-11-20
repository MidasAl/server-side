const { Configuration, OpenAIApi } = require('openai');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const logger = require('./logger');

// LLM Provider Configuration
const LLM_PROVIDER = process.env.LLM_PROVIDER || 'openai';  // Default to OpenAI
const LLM_MODEL = process.env.LLM_MODEL || 'gpt-4o-mini';   // Default model

let client;

// Initialize the appropriate LLM client based on provider
switch (LLM_PROVIDER.toLowerCase()) {
    case 'openai':
        const configuration = new Configuration({
            apiKey: process.env.OPENAI_API_KEY
        });
        client = new OpenAIApi(configuration);
        break;
    // Add other providers here
    // case 'anthropic':
    //     client = new Anthropic(...);
    //     break;
    default:
        logger.error(`Unsupported LLM provider: ${LLM_PROVIDER}`);
        throw new Error(`Unsupported LLM provider: ${LLM_PROVIDER}`);
}

// Generic function to analyze content
async function analyzeChatCompletion(messages) {
    try {
        switch (LLM_PROVIDER.toLowerCase()) {
            case 'openai':
                const response = await client.createChatCompletion({
                    model: LLM_MODEL,
                    messages: messages
                });
                return response.data.choices[0].message.content;
            // Add other providers here
            // case 'anthropic':
            //     return await client.complete(...);
            default:
                throw new Error(`Unsupported LLM provider: ${LLM_PROVIDER}`);
        }
    } catch (error) {
        logger.error(`Error in LLM analysis: ${error.message}`);
        throw error;
    }
}

module.exports = {
    client,
    analyzeChatCompletion,
    LLM_PROVIDER,
    LLM_MODEL
};