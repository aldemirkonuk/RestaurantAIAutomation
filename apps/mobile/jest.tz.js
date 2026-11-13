/** Jest globalSetup: run every mobile suite in Europe/Istanbul (see jest.config.js). */
module.exports = async () => {
  process.env.TZ = "Europe/Istanbul";
};
