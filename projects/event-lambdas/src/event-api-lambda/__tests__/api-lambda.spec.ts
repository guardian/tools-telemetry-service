import { createApp } from "../application";
import chai from "chai";
import chaiHttp from "chai-http";
import { authenticated } from "../../lib/authentication";

jest.mock("uuid", () => ({
  v4: () => "mock-uuid",
}));

jest.mock("../../lib/authentication");

import { s3 } from "../../lib/aws";
import { telemetryBucketName } from "../../lib/constants";

chai.use(chaiHttp);
chai.should();

describe("Event API lambda", () => {
  const _Date = Date;
  const constantDate = new Date("2020-09-03T17:34:37.839Z");
  const originalAuthenticated = authenticated;

  beforeAll(async () => {
    try {
      await s3.listObjects({ Bucket: telemetryBucketName }).promise();
    } catch (e) {
      throw new Error(
        `Error with localstack – the tests require localstack to be running with an S3 bucket named '${telemetryBucketName}' available. Is localstack running? The error was: ${e.message}`
      );
    }

    // @ts-ignore
    global.Date = class extends Date {
      constructor() {
        super();
        return constantDate;
      }
    };

    (authenticated as any).mockImplementation(((_, __, ___, handler) => handler()) as typeof authenticated);
  });

  afterAll(() => {
    global.Date = _Date;
    (authenticated as any).mockImplementation(originalAuthenticated);
  });

  const testApp = createApp();

  describe("/healthcheck", () => {
    it("should return 200 from healthcheck", () => {
      chai
        .request(testApp)
        .get("/healthcheck")
        .then((res) => {
          expect(res.status).toBe(200);
        });
    });
  });

  describe("/event", () => {
    it("should not accept an empty request", () => {
      const response = {
        data: [
          {
            dataPath: "",
            keyword: "type",
            message: "should be array",
            params: { type: "array" },
            schemaPath: "#/type",
          },
        ],
        message: "Incorrect event format",
        status: "error",
      };

      return chai
        .request(testApp)
        .post("/event")
        .then((res) => {
          expect(res.status).toBe(400);
          expect(res.body).toEqual(response);
        });
    });

    it("should not accept a malformed request", () => {
      const request = [
        {
          app: "example-app",
          stage: "PROD",
          type: "USER_ACTION_1",
          value: 1,
          eventTime: "this-is-not-a-datetime",
        },
      ];

      const response = {
        data: [
          {
            dataPath: "[0].eventTime",
            keyword: "format",
            message: 'should match format "date-time"',
            params: {
              format: "date-time",
            },
            schemaPath:
              "#/definitions/IUserTelemetryEvent/properties/eventTime/format",
          },
        ],
        message: "Incorrect event format",
        status: "error",
      };

      return chai
        .request(testApp)
        .post("/event")
        .send(request)
        .then((res) => {
          expect(res.status).toBe(400);
          expect(res.body).toEqual(response);
        });
    });

    it("should not accept a request with a missing value", () => {
      const request = [
        {
          stage: "PROD",
          type: "USER_ACTION_1",
          value: 1,
        },
      ];

      const response = {
        data: [
          {
            dataPath: "[0]",
            keyword: "required",
            message: "should have required property 'app'",
            params: {
              missingProperty: "app",
            },
            schemaPath: "#/definitions/IUserTelemetryEvent/required",
          },
        ],
        message: "Incorrect event format",
        status: "error",
      };

      return chai
        .request(testApp)
        .post("/event")
        .send(request)
        .then((res) => {
          expect(res.status).toBe(400);
          expect(res.body).toEqual(response);
        });
    });

    it("should accept a valid request", () => {
      const request = [
        {
          app: "example-app",
          stage: "PROD",
          type: "USER_ACTION_1",
          value: 1,
          eventTime: "2020-09-04T10:37:24.480Z",
        },
      ];

      return chai
        .request(testApp)
        .post("/event")
        .send(request)
        .then((res) => {
          expect(res.status).toBe(201);
        });
    });

    it("should write well-formed requests to S3 as NDJSON, and return the file key for easy retrieval", async () => {
      const request = [
        {
          app: "example-app",
          stage: "PROD",
          type: "USER_ACTION_1",
          value: 1,
          eventTime: "2020-09-03T11:39:42.936Z",
        },
      ];

      const res = await chai.request(testApp).post("/event").send(request);

      const expectedResponse = {
        message: "data/2020-09-03/2020-09-03T17:34:37.839Z-mock-uuid",
        status: "ok",
      };

      expect(res.status).toBe(201);
      expect(res.body).toEqual(expectedResponse);

      const params = {
        Bucket: telemetryBucketName,
        Key: res.body.message,
      };
      const writtenFile = await s3.getObject(params).promise();

      // We expect the file to contain our request as NDJSON
      const expectedFileContents = `${JSON.stringify(request[0])}\n`;
      expect(writtenFile.Body?.toString()).toBe(expectedFileContents);
    });
  });
});
