import "dotenv/config";
import app from "./app.js";

function resolvePort(rawPort) {
  const parsedPort = Number.parseInt(rawPort ?? "", 10);

  if (Number.isInteger(parsedPort) && parsedPort > 0 && parsedPort <= 65535) {
    return parsedPort;
  }

  return 3001;
}

const port = resolvePort(process.env.PORT);

app.listen(port, () => {
  console.info("[server] Travel Planner API listening", {
    port,
    nodeEnv: process.env.NODE_ENV ?? "development",
  });
});
