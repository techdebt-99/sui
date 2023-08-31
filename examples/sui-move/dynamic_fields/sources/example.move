// Copyright (c) Mysten Labs, Inc.
// SPDX-License-Identifier: Apache-2.0

module dynamic_fields::example {
    use sui::dynamic_object_field as ofield;
    use sui::object::{Self, UID};
    use sui::test_scenario;

    struct Parent has key {
        id: UID,
    }

    struct Child has key, store {
        id: UID,
        count: u64,
    }

    public fun add_child(parent: &mut Parent, child: Child) {
        ofield::add(&mut parent.id, b"child", child);
    }

    public fun mutate_child(child: &mut Child) {
        child.count = child.count + 1;
    }

    public fun mutate_child_via_parent(parent: &mut Parent) {
        mutate_child(ofield::borrow_mut(&mut parent.id, b"child"))
    }

    public fun reclaim_child(parent: &mut Parent): Child {
        ofield::remove(&mut parent.id, b"child")
    }

    public fun delete_child(parent: &mut Parent) {
        let Child { id, count: _ } = reclaim_child(parent);
        object::delete(id);
    }

    #[test]
    fun test_add_delete() {
        let ts = test_scenario::begin(@0xA);
        let ctx = test_scenario::ctx(&mut ts);

        let p = Parent { id: object::new(ctx) };
        add_child(&mut p, Child { id: object::new(ctx), count: 0 });

        mutate_child_via_parent(&mut p);
        delete_child(&mut p);

        let Parent { id } = p;
        object::delete(id);

        test_scenario::end(ts);
    }

    #[test]
    fun test_add_reclaim() {
        let ts = test_scenario::begin(@0xA);
        let ctx = test_scenario::ctx(&mut ts);

        let p = Parent { id: object::new(ctx) };
        add_child(&mut p, Child { id: object::new(ctx), count: 0 });

        mutate_child_via_parent(&mut p);

        let c = reclaim_child(&mut p);
        assert!(c.count == 1, 0);

        mutate_child(&mut c);
        assert!(c.count == 2, 1);

        let Child { id, count: _ } = c;
        object::delete(id);

        let Parent { id } = p;
        object::delete(id);

        test_scenario::end(ts);
    }

    #[test]
    /// This is not a desirable property, but objects can be deleted
    /// with dynamic fields still attached, and they become
    /// inaccessible.
    fun test_delete_with_child_attached() {
        let ts = test_scenario::begin(@0xA);
        let ctx = test_scenario::ctx(&mut ts);

        let p = Parent { id: object::new(ctx) };
        add_child(&mut p, Child { id: object::new(ctx), count: 0 });

        let Parent { id } = p;
        object::delete(id);

        test_scenario::end(ts);
    }
}