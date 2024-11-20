const { requestReimbursement } = require('../reimbursement-processor');

async function forwardReimbursementRequest(data, receiptPath) {
    try {
        logger.info('Starting forwardReimbursementRequest with path:', receiptPath);
        logger.info('Input data:', data);

        const fileObj = {
            originalname: receiptPath.split('/').pop(),
            buffer: await fs.promises.readFile(receiptPath)
        };
        
        const requestData = {
            role: data.role,
            name: data.name,
            email: data.email,
            admin_email: data.admin_email,
            reimbursement_details: data.reimbursement_details,
            files: [fileObj]
        };

        const processedResponse = await requestReimbursement(requestData);
        return processedResponse;
    } catch (error) {
        logger.error("Error in forwardReimbursementRequest:", error);
        throw error;
    }
}