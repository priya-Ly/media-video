import express from "express";
const app = express();
import https from "httpolyglot";
import path from "path";
import fs from "fs";
import mediasoup from "mediasoup";
import { Server } from "socket.io";

let port = 9090;
const __dirname = path.resolve();
const options = {
  key: fs.readFileSync("./server/ssl/key.pem", "utf-8"),
  cert: fs.readFileSync("./server/ssl/cert.pem", "utf-8"),
};
app.use("/media", express.static(path.join(__dirname, "public")));
let httpServer = https.createServer(options, app);
httpServer.listen(port, () => {
  console.log(`server listening ${port}`);
});
const io = new Server(httpServer);
let peers = io.of("/mediasoup");
let worker;
let router;
let producerTransport;
let consumerTransport;
let producer;
let consumer;
const createWorker = async () => {
  worker = await mediasoup.createWorker({
    rtcMinPort: 2000,
    rtcMaxPort: 2020,
  });
  console.log(`worker pid ${worker.pid}`);
  worker.on("died", (error) => {
    console.log("mediasoup  died", error);
    setTimeout(() => {
      process.exit(1);
    }, 2000);
  });
  return worker;
};
worker = createWorker();
const mediaCodecs = [
  {
    kind: "audio",
    mimeType: "audio/opus",
    clockRate: 48000,
    channels: 2,
  },
  {
    kind: "video",
    mimeType: "video/VP8",
    clockRate: 90000,
    parameters: {
      "x-google-start-bitrate": 1000,
    },
  },
];
peers.on("connection", async (socket) => {
  console.log(socket.id);
  socket.emit("connection-success", {
    socketId: socket.id,
  });
  socket.on("disconnect", () => {
    console.log("socket disconnected");
  });
  router = await worker.createRouter({ mediaCodecs });
  socket.on("getRtpCapabilities", (callback) => {
    const rtpCapabilities = router.rtpCapabilities;
    console.log("rtp rtpCapabilities", rtpCapabilities);
    callback({ rtpCapabilities });
  });
  socket.on("createWebRtcTransport", async ({ sender }, callback) => {
    console.log(`is this a sender request ${sender}`);
    if (sender) {
      producerTransport = await createWebRtcTransport(callback);
    } else {
      consumerTransport = await createWebRtcTransport(callback);
    }
  });
  socket.on("transport-connect", async ({ dtlsParameters }) => {
    console.log(`DTLS PARAMS: ${dtlsParameters}`);
    await producerTransport.connect({ dtlsParameters });
  });
  socket.on(
    "transport-produce",
    async ({ kind, rtpParameters, appData }, callback) => {
      producer = await producerTransport.produce({
        kind,
        rtpParameters,
      });
      console.log("producer id", producer.id, producer.kind);
      producer.on("transportclose", () => {
        console.log("transport for this producre closedd");
        producer.close();
      });
      callback({
        id: producer.id,
      });
    }
  );
  socket.on("transport-recv-connect", async ({ dtlsParameters }) => {
    console.log(`DTLS PARAMS: ${dtlsParameters}`);
    await consumerTransport.connect({
      dtlsParameters,
    });
  });
  socket.on("consume", async ({ rtpCapabilities }, callback) => {
    try {
      if (
        router.canConsume({
          producerId: producer.id,
          rtpCapabilities,
        })
      ) {
        consumer = await consumerTransport.consume({
          producerId: producer.id,
          rtpCapabilities,
          paused: true,
        });

        consumer.on("transportClose", () => {
          console.log("transpor close");
        });
        consumer.on("producerclose", () => {
          console.log("producer of consumer closed");
        });
        const params = {
          id: consumer.id,
          producerId: producer.id,
          kind: consumer.kind,
          rtpParameters: consumer.rtpParameters,
        };
        callback({ params });
      }
    } catch (error) {
      console.log(error.message);
      callback({
        params: {
          error: error,
        },
      });
    }
  });
  socket.on("consumer-resume", async () => {
    console.log("consumerr resume");
    await consumer.resume();
  });
});
const createWebRtcTransport = async (callback) => {
  try {
    const webRtcTransport_options = {
      listenIps: [{ ip: "127.0.0.1" }],
      enableUpd: true,
      enableTcp: true,
      preferUdp: true,
    };
    let transport = await router.createWebRtcTransport(webRtcTransport_options);
    console.log(`transport id ${transport.id}`);
    transport.on("dtlsstatechange", (dtlsState) => {
      if (dtlsState === "closed") {
        transport.close();
      }
    });
    transport.on("close", () => {
      console.log("transport closedd");
    });
    callback({
      params: {
        id: transport.id,
        iceParameters: transport.iceParameters,
        iceCandidates: transport.iceCandidates,
        dtlsParameters: transport.dtlsParameters,
      },
    });
    return transport;
  } catch (error) {
    console.log(error);
    callback({
      params: {
        error: error,
      },
    });
  }
};
