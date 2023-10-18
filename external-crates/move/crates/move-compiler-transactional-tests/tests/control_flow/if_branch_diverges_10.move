//# run
script {
#[allow(unneeded_return)]
fun main() {
    if (true) {
        loop return ()
    } else {
        assert!(false, 42);
        return ()
    }
}
}
