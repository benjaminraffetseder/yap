#pragma once
#include <stdbool.h>
#include <stdint.h>

bool yap_indicator_supported(void);
bool yap_indicator_configure(void *window);
bool yap_indicator_focused(void *window);
void yap_indicator_show(void *window);
void yap_indicator_place(void *window, bool keep, int *x, int *y);
bool yap_indicator_drag(void *window, int action, double x, double y, int *out_x, int *out_y);
bool yap_indicator_geometry(void *window, int *x, int *y, int *width, int *height);
bool yap_indicator_safe(void *window);
