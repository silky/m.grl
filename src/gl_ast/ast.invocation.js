// - gl_alst/ast.invocation.js ------------------------------------------- //


/* [+] please.gl.ast.Invocation(name, args)
 * 
 * AST constructor function representing function calls.
 * 
 */
please.gl.ast.Invocation = function (name, args) {
    please.gl.ast.mixin(this);
    this.name = name || null;
    this.args = args || null;
    this.bound = false;
    this.is_include_macro = false;
};


// Prints the glsl for this object.
please.gl.ast.Invocation.prototype.print = function () {
    return this.name + this.args.print()
};


// Identify function calls and collapse the relevant ast together.
// This also catches function prototypes, though only returns
// invocation objects.  Another function will transform those
// invocations into function prototypes.
please.gl.__identify_invocations = function (ast) {
    var ignore = please.gl.__symbols.concat([
        "for",
        "if",
        "else",
        "while",
        "do",
    ]);
    var remainder = [];
    ITER(i, ast) {
        var item = ast[i];
        var uncaught = true;
        if (item.constructor == please.gl.ast.Parenthetical) {
            var peek = null;
            var steps = 0;
            for (var k=i-1; k>=0; k-=1) {
                steps += 1;
                if (ast[k].constructor != please.gl.ast.Comment) {
                    peek = ast[k];
                    break;
                }
            }
            if (peek && peek.constructor == String) {
                uncaught = false;
                ITER(s, ignore) {
                    if (peek == ignore[s]) {
                        uncaught = true;
                        break;
                    }
                }
                if (!uncaught) {
                    var invoker = new please.gl.ast.Invocation(peek, item);
                    invoker.meta = peek.meta;
                    remainder = remainder.slice(0, remainder.length-steps);
                    remainder.push(invoker);
                }
            }
        }
        if (uncaught) {
            remainder.push(item);
        }
    }
    return remainder;
};


// For each unbound method invocation, find a matching method in the
// given namespace, and make the invocation's name property a getter
// that returns the method's name property.  This allows for methods
// to be dynamically renamed.
please.gl.__bind_invocations = function (stream, methods_set, scope) {
    if (!scope) {
        scope = {};
        // Build a by_name lookup for binding against.  We remove
        // overloaded functions for now as there is no way currently
        // to tell which one is the correct one to bind to.
        var overloaded = {};
        ITER(i, methods_set) {
            var name = methods_set[i].name;
            if (!scope[name] && !overloaded[name]) {
                scope[name] = methods_set[i];
            }
            else if (scope[name]) {
                overloaded[name] = true;
                delete(scope[name]);
            }
        }
    }

    var add_binding = function (invocation, method) {
        item.bound = true;
        Object.defineProperty(item, "name", {get: function () {
            return method.name;
        }});
    };

    ITER(i, stream) {
        var item = stream[i];
        if (item.constructor == please.gl.ast.Invocation) {
            if (scope[item.name]) {
                // add a binding
                add_binding(item, scope[item.name]);
            }
            please.gl.__bind_invocations(item.args, null, scope);
        }
        else if (item.constructor == please.gl.ast.Block || item.constructor == please.gl.ast.Parenthesis) {
            please.gl.__bind_invocations(item.data, null, scope);
        }
    }
};