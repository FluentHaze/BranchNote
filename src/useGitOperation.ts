import { useEffect, useState } from "react";

export default function useGitOperation() {
  const [operation, setOperation] = useState<string | null>(null);
  useEffect(() => {
    const api = window.branchNote;
    if (!api) return;
    let active = true;
    let receivedEvent = false;
    const unsubscribe = api.subscribeGitOperation(value => {
      receivedEvent = true;
      if (active) setOperation(value);
    });
    void api.getGitOperation().then(value => {
      if (active && !receivedEvent) setOperation(value);
    }).catch(() => {
      // 状态读取失败不影响主进程的互斥校验，后续事件仍可同步。
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);
  return operation;
}
