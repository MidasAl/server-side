const app = require('../server'); 
console.log('In api/index.js, typeof app:', typeof app);
module.exports = (req, res) => {
  app(req, res);
};
