// 沿用应用一次执行一个 Git 操作的方式，不排队、不自动重试。
function createGitOperation(onChange) {
  let active = null;
  return {
    current: () => active,
    async run(label, action) {
      if (active) throw new Error(`正在${active}，请等待当前 Git 操作结束`);
      active = label;
      try {
        onChange(active);
        return await action();
      } finally {
        active = null;
        onChange(active);
      }
    },
  };
}

module.exports = { createGitOperation };
