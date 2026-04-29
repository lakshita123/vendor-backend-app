let queue = Promise.resolve();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runWithOcrThrottle(task, { delayMs = 1200, retryDelayMs = 2500 } = {}) {
  const runTask = async () => {
    if (delayMs > 0) {
      await sleep(delayMs);
    }

    try {
      return await task();
    } catch (error) {
      const status = error?.response?.status || error?.status;
      const message = String(error?.message || "");
      const isRateLimit = status === 429 || message.includes("429");

      if (!isRateLimit) {
        throw error;
      }

      await sleep(retryDelayMs);
      return task();
    }
  };

  const current = queue.then(runTask, runTask);
  queue = current.catch(() => {});
  return current;
}

module.exports = {
  runWithOcrThrottle,
};
