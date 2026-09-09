// 这里保留一份 ESM 版消息常量，供 background service worker 直接 import；
// content scripts 仍使用 src/common/messages.js 的 global 版本，避免引入构建步骤。
export const MESSAGES = Object.freeze({
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
});
