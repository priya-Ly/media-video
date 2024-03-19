const io = require("socket.io-client");
const socket = io("/mediasoup");

const mediasoupClient = require("mediasoup-client");
socket.on("connection-success", (socketId) => {
  console.log("connected", socketId);
});

let rtpCapabilities;
let device;
let producerTransport;
let consumerTransport;
let producer;
let consumer;
let isProducer=false
let params = {
  encodings: [
    {
      rid: "r0",
      maxBitrate: 100000,
      scalabilityMode: "S1T3",
    },
    {
      rid: "r1",
      maxBitrate: 300000,
      scalabilityMode: "S1T3",
    },
    {
      rid: "r2",
      maxBitrate: 900000,
      scalabilityMode: "S1T3",
    },
  ],
  // https://mediasoup.org/documentation/v3/mediasoup-client/api/#ProducerCodecOptions
  codecOptions: {
    videoGoogleStartBitrate: 1000,
  },
};
const goConsume=()=>{
    goConnect(false)
}
const goConnect=(producerOrConsumer)=>{
    isProducer=producerOrConsumer
    device === undefined ? getRtpCapabilities() : goCreateTransport()
}
const goCreateTransport=()=>{
    isProducer ? createSendTransport() : createRecvTransport()
}
const streamSuccess = async (stream) => {
  localVideo.srcObject = stream;
  const track = stream.getVideoTracks()[0];
  params = {
    track,
    ...params,
  };
  goConnect(true)
};
const getLocalStream = () => {
  navigator.mediaDevices.getUserMedia(
    {
      audio: false,
      video: {
        width: {
          min: 640,
          max: 1920,
        },
        height: {
          min: 400,
          max: 1080,
        },
      },
    })
    .then(streamSuccess)
    .catch((error) => {
      console.log(error, "error from getting local stream");
    })
  }


const createDevice = async () => {
  try {
    device = new mediasoupClient.Device();
    console.log(device, "ddd");
    // Load device's RTP capabilities
    await device.load({
      routerRtpCapabilities: rtpCapabilities,
    });

    console.log("RTP Capabilities", device.rtpCapabilities);
    goCreateTransport()
  } catch (error) {
    console.error(error);
    if (error.name === "UnsupportedError") {
      console.warn("Browser not supported");
    }
  }
};

const getRtpCapabilities = async () => {
  socket.emit("createRoom", (data) => {
    console.log(`router rtp capabilties....${data.rtpCapabilities}`);
    if (typeof data.rtpCapabilities === "object") {
      rtpCapabilities = data.rtpCapabilities;
      console.log("Received RTP capabilities:", rtpCapabilities);
    } else {
      console.error("Invalid RTP capabilities received from the server.");
    }
    createDevice()
  });
};
const createSendTransport = () => {
  socket.emit(
    "createWebRtcTransport",
    {
      sender: true,
    },
    ({ params }) => {
      if (params.error) {
        console.log(params.error, "error from params");
        return;
      }
      console.log(params, "pppp");
      producerTransport = device.createSendTransport(params);
      console.log(producerTransport, "pto");
      producerTransport.on(
        "connect",
        async ({ dtlsParameters }, callback, errback) => {
          try {
            await socket.emit("transport-connect", {
              dtlsParameters,
            });
            console.log("dtls??");

            callback();
          } catch (error) {
            errback(error);
          }
        }
      );
      producerTransport.on("produce", async (parameters, callback, errback) => {
        console.log(parameters);
        try {
          await socket.emit(
            "transport-produce",
            {
              kind: parameters.kind,
              rtpParameters: parameters.rtpParameters,
              appData: parameters.appData,
            },
            ({ id }) => {
              callback({ id });
            }
          );
        } catch (error) {
          errback(error);
        }
      });
      connectSendTransport()
    }
  );
};
const connectSendTransport = async () => {
  producer = await producerTransport.produce(params);
  producer.on("trackended", () => {
    console.log("track ended");

    // close video track
  });

  producer.on("transportclose", () => {
    console.log("transport ended");

    // close video track
  });
};
const createRecvTransport = async () => {
  await socket.emit(
    "createWebRtcTransport",
    { sender: false },
    ({ params }) => {
      if (params.error) {
        console.log(params.error, "error?");
        return;
      }
      console.log(params, "dataaaa");
      consumerTransport = device.createRecvTransport(params);

      consumerTransport.on(
        "connect",
        async ({ dtlsParameters }, callback, errback) => {
          try {
            await socket.emit("transport-recv-connect", {
              dtlsParameters,
            });
            callback();
          } catch (error) {
            errback(error);
          }
        }
      );
      connectRecvTransport()
    }
  );
};
const connectRecvTransport = async () => {
  await socket.emit(
    "consume",
    {
      rtpCapabilities: device.
      rtpCapabilities,
    },
    async ({ params }) => {
      if (params.error) {
        console.log("cannot conume");
        return;
      }
      console.log(params);
      consumer = await consumerTransport.consume({
        id: params.id,
        producerId: params.producerId,
        kind: params.kind,
        rtpParameters: params.rtpParameters,
      });
      const { track } = consumer;
      remoteVideo.srcObject = new MediaStream([track]);

      socket.emit("consumer-resume");
    }
  );
};
btnLocalVideo.addEventListener("click", getLocalStream);
btnRecvSendTransport.addEventListener("click", goConsume);
