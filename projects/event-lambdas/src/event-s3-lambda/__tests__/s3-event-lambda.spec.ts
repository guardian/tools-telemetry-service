import { handler } from "../index";
import { getApiGatewayEventForPutEvent, eventsAsNDJSON } from "../../__tests__/fixtures";

import { s3, kinesis } from "../../lib/aws";
import { telemetryBucketName, telemetryStreamName } from "../../lib/constants";
import { createErrorResponse } from "../../lib/response";
import { putEventsIntoS3Bucket, getEventsFromKinesisStream } from "../../lib/util";

jest.mock("uuid", () => ({
  v4: () => "mock-uuid",
}));

describe("s3 event handler", () => {
  const _Date = Date;
  const constantDate = new Date("2020-09-03T17:34:37.839Z");

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
  });

  afterAll(() => {
    global.Date = _Date;
  });

  it("should read s3 files from the given event, and reject them if they're malformed", async () => {
    const Key = await putEventsIntoS3Bucket([{ object: "is-invalid" }] as any);

    const event = getApiGatewayEventForPutEvent(telemetryBucketName, Key);
    const lambdaResponse = await handler(event);

    const expectedResponse = JSON.stringify(
      createErrorResponse(`Invalid data in file with key ${Key}`, [
        {
          keyword: "required",
          dataPath: "[0]",
          schemaPath: "#/definitions/IUserTelemetryEvent/required",
          params: { missingProperty: "app" },
          message: "should have required property 'app'",
        },
      ])
    );
    expect(lambdaResponse.statusCode).toBe(400);
    expect(lambdaResponse.body).toEqual(expectedResponse);
  });

  it("should read s3 files from the given event, and write them to kinesis", async () => {
    const Key = "example-key";
    const s3Params = {
      Bucket: telemetryBucketName,
      Key,
      Body: eventsAsNDJSON,
    };

    await s3.putObject(s3Params).promise();
    const event = getApiGatewayEventForPutEvent(telemetryBucketName, Key);
    await handler(event);

    // The written data should be available on the stream
    const result = await getEventsFromKinesisStream();
    const dataFromStream = result.Records.map((record) =>
      record.Data.toString()
    ).find((data) => data == eventsAsNDJSON);

    expect(dataFromStream).toBe(eventsAsNDJSON);
  });
});
