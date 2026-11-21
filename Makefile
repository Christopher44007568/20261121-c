CXX ?= g++
CXXFLAGS ?= -std=c++17 -O2 -Wall -Wextra -Wno-unused-parameter
DEPFLAGS = -MMD -MP
SRCS = src/main.cpp src/math.cpp src/scene.cpp src/camera.cpp \
       src/csm.cpp src/raster.cpp src/render.cpp src/imageio.cpp \
       src/diagnostics.cpp
OBJS = $(SRCS:.cpp=.o)
DEPS = $(OBJS:.o=.d)

csm_diag: $(OBJS)
	$(CXX) $(CXXFLAGS) -o $@ $(OBJS)

%.o: %.cpp
	$(CXX) $(CXXFLAGS) $(DEPFLAGS) -c $< -o $@

run: csm_diag
	./csm_diag --mode all --out artifacts

clean:
	rm -f $(OBJS) $(DEPS) csm_diag

-include $(DEPS)
.PHONY: run clean
