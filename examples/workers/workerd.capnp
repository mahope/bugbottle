using Workerd = import "/workerd/workerd.capnp";

const config :Workerd.Config = (
  services = [(name = "receiver", worker = (
    modules = [(name = "worker", esModule = embed "bundle.mjs")],
    compatibilityDate = "2026-07-30",
    compatibilityFlags = []
  ))],
  sockets = [(name = "http", address = "127.0.0.1:0", http = (), service = "receiver")]
);
