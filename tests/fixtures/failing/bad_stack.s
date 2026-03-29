bad_func:
    addi sp, sp, -16
    sw t0, [sp]
    # Missing load (pop) for t0
    # Missing addi sp, sp, 16
    ret