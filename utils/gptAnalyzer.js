const { Configuration, OpenAIApi } = require('openai');

const config = new Configuration({
  apiKey: process.env.OPENAI_API_KEY,
});

const openai = new OpenAIApi(config);

async function analyzeWithGPT(content, isImage = false) {
  const messages = isImage
    ? [
        {
          role: 'system',
          content: `
          You are an assistant helping with reimbursement requests. 
          Analyze the receipt image and decide whether to 'Approve' or 'Reject' the request. 
          Do not consider the dates or any date-related information when processing your decision. 
          Focus solely on the content provided. Please respond in the following format:
          
          Decision: [Approve/Reject]
          Feedback: [Your explanation here]

          Please avoid using ambiguous language that might put the decision in doubt.`,
        },
        { role: 'user', content: `Please analyze this receipt image in base64 format:\n\n${content}` },
      ]
    : [
        {
          role: 'system',
          content: `
          You are an assistant helping with reimbursement requests. 
          Analyze the document and decide whether to 'Approve' or 'Reject' the request. 
          Do not consider the dates or any date-related information when processing your decision. 
          Focus solely on the content provided. Please respond in the following format:
          
          Decision: [Approve/Reject]
          Feedback: [Your explanation here]

          Please avoid using ambiguous language that might put the decision in doubt.`,
        },
        { role: 'user', content: `Here is the document content:\n\n${content}` },
      ];

  const response = await openai.createChatCompletion({
    model: 'gpt-4o-mini',
    messages,
  });

  const decision = response.data.choices[0].message.content;
  console.log('GPT Response:', decision);

  return {
    decision: decision.includes('Approve') ? 'Approve' : 'Reject',
    feedback: decision,
  };
}

module.exports = { analyzeWithGPT };
