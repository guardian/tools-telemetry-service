import { createApp } from "../application";
import chai from "chai";
import chaiHttp from "chai-http";

chai.use(chaiHttp);
chai.should();

describe("Event API lambda", () => {
  const testApp = createApp();
  it("should return 200 from healthcheck", (done) => {
    chai
      .request(testApp)
      .get("/healthcheck")
      .end((_, res) => {
        expect(res.status).toBe(200);
        done();
      });
  });
});