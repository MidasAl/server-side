const { Configuration, OpenAIApi } = require('openai');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const configuration = new Configuration({
    apiKey: process.env.OPENAI_API_KEY
});

const client = new OpenAIApi(configuration);

module.exports = client;