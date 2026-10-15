fn main() {
    embuild::espidf::sysenv::output();
    let protoc = protoc_bin_vendored::protoc_bin_path().expect("protoc binary");
    unsafe { std::env::set_var("PROTOC", protoc); }
    println!("cargo:rerun-if-changed=../../packages/sync-protocol/proto/memorilo.proto");
    prost_build::Config::new()
        .compile_protos(
            &["../../packages/sync-protocol/proto/memorilo.proto"],
            &["../../packages/sync-protocol/proto"],
        )
        .expect("compile Memorilo protobuf schema");
}
