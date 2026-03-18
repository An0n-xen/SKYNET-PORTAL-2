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
  logger.debug(
    { username, passwordLength: password.length, radiusHost: RADIUS_HOST, radiusPort: RADIUS_PORT },
    "RADIUS verifyCredentials called",
  );

  return new Promise((resolve, reject) => {
    const identifier = Math.floor(Math.random() * 256);
    const packet = {
      code: "Access-Request",
      secret: RADIUS_SECRET,
      identifier,
      attributes: [
        ["User-Name", username],
        ["User-Password", password],
      ] as [string, string][],
    };

    logger.debug(
      { username, identifier, host: RADIUS_HOST, port: RADIUS_PORT, retries: 8, timeout: 5000 },
      "RADIUS sending Access-Request",
    );

    const startTime = Date.now();

    radclient(
      packet,
      { host: RADIUS_HOST, port: RADIUS_PORT, timeout: 5000, retries: 8 },
      (err, response) => {
        const elapsed = Date.now() - startTime;

        if (err) {
          logger.error(
            { err: err.message, username, elapsed, identifier },
            "RADIUS auth error — possible causes: MikroTik unreachable, secret mismatch, timeout",
          );
          reject(err);
          return;
        }

        const accepted = response.code === "Access-Accept";
        logger.info(
          {
            username,
            code: response.code,
            accepted,
            elapsed,
            identifier,
            attributes: response.attributes,
          },
          `RADIUS auth response — ${accepted ? "ACCEPTED" : "REJECTED (wrong password, expired profile, or shared-users exceeded)"}`,
        );
        resolve(accepted);
      },
    );
  });
}
