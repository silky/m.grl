// - m.jta.js ------------------------------------------------------------- //


// "jta" media type handler
please.media.search_paths.jta = "";
please.media.handlers.jta = function (url, callback) {
    var media_callback = function (req) {
        please.media.assets[url] = please.gl.__jta_model(req.response, url);
    };
    please.media.__xhr_helper("text", url, media_callback, callback);
};


// JTA model loader.  This will replace the old one once it works.
please.gl.new_jta = function (src, uri) {
    // The structure of a JTA file is json.  Large blocks of agregate
    // data are base64 encoded binary data.

    var directory = JSON.parse(src);
    var scene = {
        "meta" : directory.meta,
        "models" : {},
    };

    // assert a minimum and maximum version number
    console.assert(directory.meta.jta_version >= 0.1);
    console.assert(directory.meta.jta_version < 1.0);

    // unpack textures
    please.gl.__jta_unpack_textures(directory.packed_data);
    directory.packed_data=null;// free up a potentially large amount of memory.

    // stash bones data FIXME: there is no spec yet for this...
    if (directory.bones) {
        scene.bones = bones;
    }

    // stash optional data
    if (directory.extras) {
        scene.extras = extras;
    }

    // extract model data
    var vbos = please.gl.__jta_extract_vbos(directory.attributes);
    scene.models = please.gl.__jta_extract_models(directory.models, vbos);

    scene.test_draw = function () {
        vbos[0].bind();
        please.prop_map(scene.models, function(name, model) {

            // load up state stuff
            var prog = please.gl.get_program();
            please.prop_map(model.samplers, function(name, uri) {
                if (prog.samplers.hasOwnProperty(name)) {
                    prog.samplers[name] = uri;
                }
            });
            please.prop_map(model.uniforms, function(name, value) {
                if (prog.vars.hasOwnProperty(name)) {
                    prog.vars[name] = value;
                }
            });
            please.prop_map(model.groups, function(group_name, group) {
                group.ibo.bind();
                group.ibo.draw();
            });
        });
    };

    console.info("Done loading " + uri +" ...?");
    return scene;
};


// This function extracts a stored typed array.
please.gl.__jta_array = function (array) {
    console.assert(array.type === "Array");
    console.assert(array.hint !== undefined);
    console.assert(array.data !== undefined);
    var blob = array.data;
    var hint = array.hint;
    return please.typed_array(blob, hint);
};


// Extract the model objects defined in the jta file.
please.gl.__jta_extract_models = function (model_defs, vbos) {
    var models = please.prop_map(model_defs, function(name, model_def) {
        // The model object contains all the data needed to render a
        // singular model within a scene. All of the models in a scene
        // with similar propreties will share the same vbo (within
        // reason).
        var model = {
            "parent" : model_def.parent,
            "vbo" : vbos[model_def.struct],
            "uniforms" : {},
            "samplers" : {},
            "extra" : model_def.extra,
            "groups" : [],
        };
        please.prop_map(model_def.groups, function(group_name, group) {
            // groups coorespond to IBOs, but also store the name of
            // relevant bone matrices.
            // FIXME - these should all use the same IBO, but make use of ranges!
            var element_array = please.gl.__jta_array(group.faces);
            var group = {
                "bones" : group.bones,
                "ibo" : please.gl.ibo(element_array),
            };
            model.groups.push(group);
        });
        please.prop_map(model_def.state, function(state_name, state) {
            if (state.type === "Sampler2D") {
                var uri = null;
                if (state.uri.startsWith("ref:")) {
                    // target is relative loaded
                    uri = state.uri.slice(4);
                }
                else if (state.uri.startsWith("packed:")) {
                    // target is a packed image
                    uri = state.uri.slice(7);
                }
                if (uri) {
                    model.samplers[state_name] = uri;
                }
            }
            else if (state.type === "Array") {
                model.uniforms[state_name] = please.gl.__jta_array(state);
            }
            else {
                throw ("Not implemented: non-array uniforms from jta export");
            }
        });
        return model;
    });
    return models;
};


// Extract the vertex buffer objects defined in the jta file.
please.gl.__jta_extract_vbos = function (attributes) {
    return attributes.map(function(attr_data) {
        var position_data = please.gl.__jta_array(attr_data["position"])
        var attr_map = {
            "position" : position_data,
        };
        
        // extract UV coordinates
        if (attr_data.tcoords !== undefined && attr_data.tcoords.length >= 1) {
            // FIXME: use all UV layers, not just the first one
            attr_map["tcoord"] = please.gl.__jta_array(attr_data["tcoords"][0]);
        }

        // extract bone weights
        if (attr_data.weights !== undefined) {
            attr_map["weights"] = please.gl.__jta_array(attr_data["weights"]);
        }

        var vertex_count = attr_map.position.length / attr_data["position"].item;
        return please.gl.vbo(vertex_count, attr_map);
    });
}


// This function creates image objects for any textures packed in the
// jta file.
please.gl.__jta_unpack_textures = function (packed_data) {
    ITER_PROPS(checksum, packed_data) {
        if (!please.access(checksum, true)) {
            var img = new Image();
            img.src = packed_data[checksum];
            please.media.assets[checksum] = img;
        }
    }
};



// the old JTA model loader.  This is just a quick-and-dirty
// implementation, and is deprecated.
please.gl.__jta_model = function (src, uri) {
    // The structure of a JTA file is json.  Large blocks of agregate
    // data are base64 encoded binary data.

    var directory = JSON.parse(src);
    if (directory.meta.jta_version !== undefined) {
        // call the new jta loader instead
        return please.gl.new_jta(src, uri);
    }

    var groups = directory["vertex_groups"];
    var uniforms = directory["vars"];
    var model = {
        "__groups" : [],
        "uniforms" : {},

        "bind" : function () {
            for (var i=0; i<this.__groups.length; i+=1) {
                this.__groups[i].bind();
            }
        },

        "draw" : function () {
            for (var i=0; i<this.__groups.length; i+=1) {
                this.__groups[i].draw();
            }
        },
    };

    // Note suggested uniform values, unpack data, and possibly queue
    // up additional image downloads:
    please.get_properties(uniforms).map(function(name) {
        var meta = uniforms[name];
        if (meta.hint === "Sampler2D") {
            var uri;
            if (meta.mode === "linked") {
                uri = meta.uri;
                if (please.gl.relative_lookup) {
                    please.relative_load("img", uri);

                }
                else {
                    please.load("img", uri);                    
                }
            }
            else if (meta.mode === "packed") {
                uri = meta.md5;
                if (!please.access(uri, true)) {
                    var img = new Image();
                    img.src = meta.uri;
                    please.media.assets[uri] = img;
                }
            }
            else {
                console.error("Cannot load texture of type: " + meta.mode);
            }
            if (uri) {
                model.uniforms[name] = uri;
            }
        }
        else {
            console.warn("Not implemented: " + meta.hint);
        }
    });


    // Create our attribute lists.  Closure to avoid scope polution.
    please.get_properties(groups).map(function(name) {
        var vertices = groups[name];
        if (!vertices.position) {
            throw("JTA model " + uri + " is missing the 'position' attribute!!");
        }

        var attr_map = {};

        for (var attr in vertices) {
            var hint = vertices[attr].hint;
            var raw = vertices[attr].data;
            attr_map[attr] = please.typed_array(raw, hint);
        }

        var faces = attr_map.position.length / 3;
        var vbo = please.gl.vbo(faces, attr_map);

        if (vbo) {
            console.info("Created vbo for: " + uri + " / " + name);
            model.__groups.push(vbo);
        }
    });

    return model;
};
