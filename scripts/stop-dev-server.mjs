import { execSync } from "node:child_process";

function killPort(port) {
  try {
    if (process.platform === "win32") {
      const output = execSync(`netstat -ano | findstr :${port}`, { encoding: "utf8" });
      const pids = new Set();

      for (const line of output.split(/\r?\n/)) {
        if (!line.includes("LISTENING")) continue;
        const pid = line.trim().split(/\s+/).at(-1);
        if (pid && pid !== "0") pids.add(pid);
      }

      for (const pid of pids) {
        try {
          execSync(`taskkill /PID ${pid} /F`, { stdio: "ignore" });
          console.log(`Stopped dev server (PID ${pid}) on port ${port}.`);
        } catch {
          // Process may already be gone.
        }
      }
      return;
    }

    execSync(`lsof -ti:${port} | xargs kill -9 2>/dev/null || true`, {
      stdio: "ignore",
      shell: true,
    });
  } catch {
    // Nothing listening on the port.
  }
}

killPort(3000);
