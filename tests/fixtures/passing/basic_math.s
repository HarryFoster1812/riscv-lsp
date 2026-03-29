main:
    addi sp, sp, -8
    sw t0, [sp]
    add t1, t2, t0
    lw t0, [sp]
    addi sp, sp, 8
    ret