pub mod memorilo {
    pub mod sync {
        pub mod v1 {
            include!(concat!(env!("OUT_DIR"), "/memorilo.sync.v1.rs"));
        }
    }
}
