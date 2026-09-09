(function (root) {
  const messages = {
    PING: "PING",
    GET_CONFIG: "GET_CONFIG",
    GET_UI_CONFIG: "GET_UI_CONFIG",
    OPEN_OPTIONS: "OPEN_OPTIONS",
    SET_CONFIG: "SET_CONFIG",
    GET_PROFILE: "GET_PROFILE",
    SET_PROFILE: "SET_PROFILE",
    SCORE_JOB: "SCORE_JOB",
    SCORE_JOBS: "SCORE_JOBS",
    GENERATE_GREETING: "GENERATE_GREETING",
    SAVE_JOB: "SAVE_JOB",
    GET_JOBS: "GET_JOBS",
    DELETE_JOB: "DELETE_JOB",
    SET_JOB_STATUS: "SET_JOB_STATUS"
  };
  root.OfferClaw = root.OfferClaw || {};
  root.OfferClaw.MESSAGES = messages;
  if (typeof module !== "undefined" && module.exports) module.exports = messages;
})(globalThis);
