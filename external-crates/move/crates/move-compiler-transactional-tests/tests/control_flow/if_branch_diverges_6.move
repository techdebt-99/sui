//# run
script {
#[allow(unneeded_return)]
fun main() {
    if (true) {
        loop { if (true) return () else break }
    } else {
        assert!(false, 42);
        return ()
    }
}
}
