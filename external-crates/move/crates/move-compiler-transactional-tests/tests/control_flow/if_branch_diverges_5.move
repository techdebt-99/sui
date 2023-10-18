//# run
script {
#[allow(unneeded_return)]
fun main() {
    if (true) {
        loop break
    } else {
        assert!(false, 42);
        return ()
    }
}
}
