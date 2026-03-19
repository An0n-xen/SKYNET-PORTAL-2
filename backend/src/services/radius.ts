import radclient from "radclient";
import logger from "../logger";

const RADIUS_HOST =
  process.env.MIKROTIK_API_URL?.replace("http://", "").split(":")[0] ||
  "192.168.88.1";
const RADIUS_SECRET = process.env.RADIUS_SECRET || "testing123";
const RADIUS_PORT = 1812;

export async function verifyCredentials(
  username: string,
  password: string,
): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const packet = {
      code: "Access-Request",
      secret: RADIUS_SECRET,
      identifier: Math.floor(Math.random() * 256),
      attributes: [
        ["User-Name", username],
        ["User-Password", password],
      ] as [string, string][],
    };

    radclient(
      packet,
      { host: RADIUS_HOST, port: RADIUS_PORT, timeout: 5000, retries: 3 },
      (err, response) => {
        if (err) {
          logger.error({ err: err.message, username }, "RADIUS auth error");
          reject(err);
          return;
        }
        logger.info({ username, code: response.code }, "RADIUS auth response");
        resolve(response.code === "Access-Accept");
      },
    );
  });
}
