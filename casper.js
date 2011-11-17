/*!
 * Casper is a navigation utility for PhantomJS.
 *
 * Documentation: http://n1k0.github.com/casperjs/
 * Repository:    http://github.com/n1k0/casperjs
 *
 * Copyright (c) 2011 Nicolas Perriault
 *
 * Permission is hereby granted, free of charge, to any person obtaining a
 * copy of this software and associated documentation files (the "Software"),
 * to deal in the Software without restriction, including without limitation
 * the rights to use, copy, modify, merge, publish, distribute, sublicense,
 * and/or sell copies of the Software, and to permit persons to whom the
 * Software is furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included
 * in all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
 * OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL
 * THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
 * FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
 * DEALINGS IN THE SOFTWARE.
 *
 */
(function(phantom) {
    /**
     * Main Casper object.
     *
     * @param  Object  options  Casper options
     * @return Casper
     */
    phantom.Casper = function(options) {
        var DEFAULT_DIE_MESSAGE = "Suite explicitely interrupted without any message given.";
        var DEFAULT_USER_AGENT  = "Mozilla/5.0 (Windows NT 6.0) AppleWebKit/535.1 (KHTML, like Gecko) Chrome/13.0.782.112 Safari/535.1";
        // init & checks
        if (!(this instanceof arguments.callee)) {
            return new Casper(options);
        }
        // default options
        this.defaults = {
            clientScripts:     [],
            faultTolerant:     true,
            logLevel:          "error",
            onDie:             null,
            onError:           null,
            onLoadError:       null,
            onPageInitialized: null,
            page:              null,
            pageSettings:      { userAgent: DEFAULT_USER_AGENT },
            timeout:           null,
            verbose:           false
        };
        // privates
        // local properties
        this.checker = null;
        this.colorizer = new phantom.Casper.Colorizer();
        this.currentUrl = 'about:blank';
        this.currentHTTPStatus = 200;
        this.defaultWaitTimeout = 5000;
        this.delayedExecution = false;
        this.history = [];
        this.loadInProgress = false;
        this.logLevels = ["debug", "info", "warning", "error"];
        this.logStyles = {
            debug:   'INFO',
            info:    'PARAMETER',
            warning: 'COMMENT',
            error:   'ERROR'
        };
        this.options = mergeObjects(this.defaults, options);
        this.page = null;
        this.requestUrl = 'about:blank';
        this.result = {
            log:    [],
            status: "success",
            time:   0
        };
        this.started = false;
        this.step = 0;
        this.steps = [];
        this.test = new phantom.Casper.Tester(this);
    };

    /**
     * Casper prototype
     */
    phantom.Casper.prototype = {
        /**
         * Go a step back in browser's history
         *
         * @return Casper
         */
        back: function() {
            return this.then(function(self) {
                self.evaluate(function() {
                    history.back();
                });
            });
        },

        /**
         * Encodes a resource using the base64 algorithm synchroneously using
         * client-side XMLHttpRequest.
         *
         * NOTE: we cannot use window.btoa() for some strange reasons here.
         *
         * @param  String  url  The url to download
         * @return string       Base64 encoded result
         */
        base64encode: function(url) {
            return this.evaluate(function() {
                return __utils__.getBase64(__casper_params__.url);
            }, {
                url: url
            });
        },

        /**
         * Use Gibberish AES library to encode a string using a password.
         *
         * @param  String  text        Some text to encode
         * @param  String  password    The password to use to encode the text
         * @return String              AES encoded result
         */
        aesEncode: function(text, password) {
            try {
                var encode = GibberishAES.enc;
            } catch (e) {
                throw 'GibberishAES library not found. Did you forget to phantom.injectJs("gibberish-aes.js")?';
            }
            return encode(text, password);
        },

        /**
         * Use Gibberish AES library to decode a string using a password.
         *
         * @param  String  text        Some text to decode
         * @param  String  password    The password to use to decode the text
         * @return String              Decoded result
         */
        aesDecode: function(text, password) {
            try {
                var decode = GibberishAES.dec;
            } catch (e) {
                throw 'GibberishAES library not found. Did you forget to phantom.injectJs("gibberish-aes.js")?';
            }
            return decode(text, password);
        },


        /**
         * Proxy method for WebPage#render. Adds a clipRect parameter for
         * automatically set page clipRect setting values and sets it back once
         * done. If the cliprect parameter is omitted, the full page viewport
         * area will be rendered.
         *
         * @param  String  targetFile  A target filename
         * @param  mixed   clipRect    An optional clipRect object (optional)
         * @return Casper
         */
        capture: function(targetFile, clipRect) {
            var previousClipRect;
            if (clipRect) {
                if (!isType(clipRect, "object")) {
                    throw new Error("clipRect must be an Object instance.");
                }
                previousClipRect = this.page.clipRect;
                this.page.clipRect = clipRect;
                this.log('Capturing page to ' + targetFile + ' with clipRect' + JSON.stringify(clipRect), "debug");
            } else {
                this.log('Capturing page to ' + targetFile, "debug");
            }
            try {
                this.page.render(targetFile);
            } catch (e) {
                this.log('Failed to capture screenshot as ' + targetFile + ': ' + e, "error");
            }
            if (previousClipRect) {
                this.page.clipRect = previousClipRect;
            }
            return this;
        },

        /**
         * Captures the page area containing the provided selector.
         *
         * @param  String  targetFile  Target destination file path.
         * @param  String  selector    CSS3 selector
         * @return Casper
         */
        captureSelector: function(targetFile, selector) {
            return this.capture(targetFile, this.evaluate(function() {
                try {
                    var clipRect = document.querySelector(__casper_params__.selector).getBoundingClientRect();
                    return {
                        top:    clipRect.top,
                        left:   clipRect.left,
                        width:  clipRect.width,
                        height: clipRect.height
                    };
                } catch (e) {
                    __utils__.log("Unable to fetch bounds for element " + __casper_params__.selector, "warning");
                }
            }, {
                selector: selector
            }));
        },

        /**
         * Checks for any further navigation step to process.
         *
         * @param  Casper    self        A self reference
         * @param  function  onComplete  An options callback to apply on completion
         */
        checkStep: function(self, onComplete) {
            var step = self.steps[self.step];
            if (!self.loadInProgress && isType(step, "function")) {
                var curStepNum = self.step + 1;
                var stepInfo   = "Step " + curStepNum + "/" + self.steps.length + ": ";
                self.log(stepInfo + self.page.evaluate(function() {
                    return document.location.href;
                }) + ' (HTTP ' + self.currentHTTPStatus + ')', "info");
                try {
                    step(self);
                } catch (e) {
                    if (self.options.faultTolerant) {
                        self.log("Step error: " + e, "error");
                    } else {
                        throw e;
                    }
                }
                var time = new Date().getTime() - self.startTime;
                self.log(stepInfo + "done in " + time + "ms.", "info");
                self.step++;
            }
            if (!isType(step, "function") && !self.delayedExecution) {
                self.result.time = new Date().getTime() - self.startTime;
                self.log("Done " + self.steps.length + " steps in " + self.result.time + 'ms.', "info");
                clearInterval(self.checker);
                if (isType(onComplete, "function")) {
                    try {
                        onComplete(self);
                    } catch (err) {
                        self.log("could not complete final step: " + err, "error");
                    }
                } else {
                    // default behavior is to exit phantom
                    self.exit();
                }
            }
        },

        /**
         * Emulates a click on the element from the provided selector, if
         * possible. In case of success, `true` is returned.
         *
         * @param  String   selector        A DOM CSS3 compatible selector
         * @param  Boolean  fallbackToHref  Whether to try to relocate to the value of any href attribute (default: true)
         * @return Boolean
         */
        click: function(selector, fallbackToHref) {
            fallbackToHref = isType(fallbackToHref, "undefined") ? true : !!fallbackToHref;
            this.log("click on selector: " + selector, "debug");
            return this.evaluate(function() {
                return __utils__.click(__casper_params__.selector, __casper_params__.fallbackToHref);
            }, {
                selector:       selector,
                fallbackToHref: fallbackToHref
            });
        },

        /**
         * Logs the HTML code of the current page.
         *
         * @return Casper
         */
        debugHTML: function() {
            this.echo(this.evaluate(function() {
                return document.body.innerHTML;
            }));
            return this;
        },

        /**
         * Logs the textual contents of the current page.
         *
         * @return Casper
         */
        debugPage: function() {
            this.echo(this.evaluate(function() {
                return document.body.innerText;
            }));
            return this;
        },

        /**
         * Exit phantom on failure, with a logged error message.
         *
         * @param  String  message  An optional error message
         * @param  Number  status   An optional exit status code (must be > 0)
         * @return Casper
         */
        die: function(message, status) {
            this.result.status = 'error';
            this.result.time = new Date().getTime() - this.startTime;
            message = isType(message, "string") && message.length > 0 ? message : DEFAULT_DIE_MESSAGE;
            this.log(message, "error");
            if (isType(this.options.onDie, "function")) {
                this.options.onDie(this, message, status);
            }
            return this.exit(Number(status) > 0 ? Number(status) : 1);
        },

        /**
         * Iterates over the values of a provided array and execute a callback
         * for each item.
         *
         * @param  Array     array
         * @param  Function  fn     Callback: function(self, item, index)
         * @return Casper
         */
        each: function(array, fn) {
            if (array.constructor !== Array) {
                self.log("each() only works with arrays", "error");
                return this;
            }
            (function(self) {
                array.forEach(function(item, i) {
                    fn(self, item, i);
                });
            })(this);
            return this;
        },

        /**
         * Prints something to stdout.
         *
         * @param  String  text  A string to echo to stdout
         * @return Casper
         */
        echo: function(text, style) {
            console.log(style ? this.colorizer.colorize(text, style) : text);
            return this;
        },

        /**
         * Evaluates an expression in the page context, a bit like what
         * WebPage#evaluate does, but can also replace values by their
         * placeholer names:
         *
         *     casper.evaluate(function() {
         *         document.querySelector('#username').value = '%username%';
         *         document.querySelector('#password').value = '%password%';
         *         document.querySelector('#submit').click();
         *     }, {
         *         username: 'Bazoonga',
         *         password: 'baz00nga'
         *     })
         *
         * As an alternative, CasperJS injects a `__casper_params__` Object
         * instance containing all the parameters you passed:
         *
         *     casper.evaluate(function() {
         *         document.querySelector('#username').value = __casper_params__.username;
         *         document.querySelector('#password').value = __casper_params__.password;
         *         document.querySelector('#submit').click();
         *     }, {
         *         username: 'Bazoonga',
         *         password: 'baz00nga'
         *     })
         *
         * FIXME: waiting for a patch of PhantomJS to allow direct passing of
         * arguments to the function.
         * TODO: don't forget to keep this backward compatible.
         *
         * @param  function  fn            The function to be evaluated within current page DOM
         * @param  object    replacements  Parameters to pass to the remote environment
         * @return mixed
         * @see    WebPage#evaluate
         */
        evaluate: function(fn, replacements) {
            replacements = isType(replacements, "object") ? replacements : {};
            this.page.evaluate(replaceFunctionPlaceholders(function() {
                window.__casper_params__ = {};
                try {
                    var jsonString = unescape(decodeURIComponent('%replacements%'));
                    window.__casper_params__ = JSON.parse(jsonString);
                } catch (e) {
                    __utils__.log("Unable to replace parameters: " + e, "error");
                }
            }, {
                replacements: encodeURIComponent(escape(JSON.stringify(replacements).replace("'", "\'")))
            }));
            return this.page.evaluate(replaceFunctionPlaceholders(fn, replacements));
        },

        /**
         * Evaluates an expression within the current page DOM and die() if it
         * returns false.
         *
         * @param  function  fn       The expression to evaluate
         * @param  String    message  The error message to log
         * @return Casper
         */
        evaluateOrDie: function(fn, message) {
            if (!this.evaluate(fn)) {
                return this.die(message);
            }
            return this;
        },

        /**
         * Checks if an element matching the provided CSS3 selector exists in
         * current page DOM.
         *
         * @param  String  selector  A CSS3 selector
         * @return Boolean
         */
        exists: function(selector) {
            return this.evaluate(function() {
                return __utils__.exists(__casper_params__.selector);
            }, {
                selector: selector
            });
        },

        /**
         * Exits phantom.
         *
         * @param  Number  status  Status
         * @return Casper
         */
        exit: function(status) {
            phantom.exit(status);
            return this;
        },

        /**
         * Fetches innerText within the element(s) matching a given CSS3
         * selector.
         *
         * @param  String  selector  A CSS3 selector
         * @return String
         */
        fetchText: function(selector) {
            return this.evaluate(function() {
                return __utils__.fetchText(__casper_params__.selector);
            }, {
                selector: selector
            });
        },

        /**
         * Fills a form with provided field values.
         *
         * @param  String  selector  A CSS3 selector to the target form to fill
         * @param  Object  vals      Field values
         * @param  Boolean submit    Submit the form?
         */
        fill: function(selector, vals, submit) {
            submit = submit === true ? submit : false;
            if (!isType(selector, "string") || !selector.length) {
                throw "form selector must be a non-empty string";
            }
            if (!isType(vals, "object")) {
                throw "form values must be provided as an object";
            }
            var fillResults = this.evaluate(function() {
               return __utils__.fill(__casper_params__.selector, __casper_params__.values);
            }, {
                selector: selector,
                values:   vals
            });
            if (!fillResults) {
                throw "unable to fill form";
            } else if (fillResults.errors.length > 0) {
                (function(self){
                    fillResults.errors.forEach(function(error) {
                        self.log("form error: " + error, "error");
                    });
                })(this);
                if (submit) {
                    this.log("errors encountered while filling form; submission aborted", "warning");
                    submit = false;
                }
            }
            // File uploads
            if (fillResults.files && fillResults.files.length > 0) {
                (function(self) {
                    fillResults.files.forEach(function(file) {
                        var fileFieldSelector = [selector, 'input[name="' + file.name + '"]'].join(' ');
                        self.page.uploadFile(fileFieldSelector, file.path);
                    });
                })(this);
            }
            // Form submission?
            if (submit) {
                this.evaluate(function() {
                    var form = document.querySelector(__casper_params__.selector);
                    var method = form.getAttribute('method').toUpperCase() || "GET";
                    var action = form.getAttribute('action') || "unknown";
                    __utils__.log('submitting form to ' + action + ', HTTP ' + method, 'info');
                    form.submit();
                }, {
                    selector: selector
                });
            }
        },

        /**
         * Go a step forward in browser's history
         *
         * @return Casper
         */
        forward: function(then) {
            return this.then(function(self) {
                self.evaluate(function() {
                    history.forward();
                });
            });
        },

        /**
         * Retrieves current document url.
         *
         * @return String
         */
        getCurrentUrl: function() {
            return decodeURIComponent(this.evaluate(function() {
                return document.location.href;
            }));
        },

        /**
         * Retrieves global variable.
         *
         * @param  String  name  The name of the global variable to retrieve
         * @return mixed
         */
        getGlobal: function(name) {
            return this.evaluate(function() {
                return window[window.__casper_params__.name];
            }, {'name': name});
        },

        /**
         * Retrieves current page title, if any.
         *
         * @return String
         */
        getTitle: function() {
            return this.evaluate(function() {
                return document.title;
            });
        },

        /**
         * Logs a message.
         *
         * @param  String  message  The message to log
         * @param  String  level    The log message level (from Casper.logLevels property)
         * @param  String  space    Space from where the logged event occured (default: "phantom")
         * @return Casper
         */
        log: function(message, level, space) {
            level = level && this.logLevels.indexOf(level) > -1 ? level : "debug";
            space = space ? space : "phantom";
            if (level === "error" && isType(this.options.onError, "function")) {
                this.options.onError(this, message, space);
            }
            if (this.logLevels.indexOf(level) < this.logLevels.indexOf(this.options.logLevel)) {
                return this; // skip logging
            }
            if (this.options.verbose) {
                var levelStr = this.colorizer.colorize('[' + level + ']', this.logStyles[level]);
                this.echo(levelStr + ' [' + space + '] ' + message); // direct output
            }
            this.result.log.push({
                level:   level,
                space:   space,
                message: message,
                date:    new Date().toString()
            });
            return this;
        },

        /**
         * Opens a page. Takes only one argument, the url to open (using the
         * callback argument would defeat the whole purpose of Casper
         * actually).
         *
         * @param  String  location  The url to open
         * @return Casper
         */
        open: function(location) {
            this.requestUrl = location;
            this.page.open(location);
            return this;
        },

        /**
         * Repeats a step a given number of times.
         *
         * @param  Number    times  Number of times to repeat step
         * @aram   function  then   The step closure
         * @return Casper
         * @see    Casper#then
         */
        repeat: function(times, then) {
            for (var i = 0; i < times; i++) {
                this.then(then);
            }
            return this;
        },

        /**
         * Runs the whole suite of steps.
         *
         * @param  function  onComplete  an optional callback
         * @param  Number    time        an optional amount of milliseconds for interval checking
         * @return Casper
         */
        run: function(onComplete, time) {
            if (!this.steps || this.steps.length < 1) {
                this.log("No steps defined, aborting", "error");
                return this;
            }
            this.log("Running suite: " + this.steps.length + " step" + (this.steps.length > 1 ? "s" : ""), "info");
            this.checker = setInterval(this.checkStep, (time ? time: 250), this, onComplete);
            return this;
        },

        /**
         * Configures and starts Casper.
         *
         * @param  String   location  An optional location to open on start
         * @param  function then      Next step function to execute on page loaded (optional)
         * @return Casper
         */
        start: function(location, then) {
            if (this.started) {
                this.log("start failed: Casper has already started!", "error");
            }
            this.log('Starting...', "info");
            this.startTime = new Date().getTime();
            this.steps = [];
            this.step = 0;
            // Option checks
            if (this.logLevels.indexOf(this.options.logLevel) < 0) {
                this.log("Unknown log level '" + this.options.logLevel + "', defaulting to 'warning'", "warning");
                this.options.logLevel = "warning";
            }
            // WebPage
            if (!isWebPage(this.page)) {
                if (isWebPage(this.options.page)) {
                    this.page = this.options.page;
                } else {
                    this.page = createPage(this);
                }
            }
            this.page.settings = mergeObjects(this.page.settings, this.options.pageSettings);
            if (isType(this.options.clipRect, "object")) {
                this.page.clipRect = this.options.clipRect;
            }
            if (isType(this.options.viewportSize, "object")) {
                this.page.viewportSize = this.options.viewportSize;
            }
            this.started = true;
            if (isType(this.options.timeout, "number") && this.options.timeout > 0) {
                self.log("execution timeout set to " + this.options.timeout + 'ms', "info");
                setTimeout(function(self) {
                    self.log("timeout of " + self.options.timeout + "ms exceeded", "info").exit();
                }, this.options.timeout, this);
            }
            if (isType(this.options.onPageInitialized, "function")) {
                this.log("Post-configuring WebPage instance", "debug");
                this.options.onPageInitialized(this.page);
            }
            if (isType(location, "string") && location.length > 0) {
                if (isType(then, "function")) {
                    return this.open(location).then(then);
                } else {
                    return this.open(location);
                }
            }
            return this;
        },

        /**
         * Schedules the next step in the navigation process.
         *
         * @param  function  step  A function to be called as a step
         * @return Casper
         */
        then: function(step) {
            if (!this.started) {
                throw "Casper not started; please use Casper#start";
            }
            if (!isType(step, "function")) {
                throw "You can only define a step as a function";
            }
            this.steps.push(step);
            return this;
        },

        /**
         * Adds a new navigation step for clicking on a provided link selector
         * and execute an optional next step.
         *
         * @param  String   selector        A DOM CSS3 compatible selector
         * @param  Function then            Next step function to execute on page loaded (optional)
         * @param  Boolean  fallbackToHref  Whether to try to relocate to the value of any href attribute (default: true)
         * @return Casper
         * @see    Casper#click
         * @see    Casper#then
         */
        thenClick: function(selector, then, fallbackToHref) {
            this.then(function(self) {
                self.click(selector, fallbackToHref);
            });
            return isType(then, "function") ? this.then(then) : this;
        },

        /**
         * Adds a new navigation step to perform code evaluation within the
         * current retrieved page DOM.
         *
         * @param  function  fn            The function to be evaluated within current page DOM
         * @param  object    replacements  Optional replacements to performs, eg. for '%foo%' => {foo: 'bar'}
         * @return Casper
         * @see    Casper#evaluate
         */
        thenEvaluate: function(fn, replacements) {
            return this.then(function(self) {
                self.evaluate(fn, replacements);
            });
        },

        /**
         * Adds a new navigation step for opening the provided location.
         *
         * @param  String   location  The URL to load
         * @param  function then      Next step function to execute on page loaded (optional)
         * @return Casper
         * @see    Casper#open
         */
        thenOpen: function(location, then) {
            this.then(function(self) {
                self.open(location);
            });
            return isType(then, "function") ? this.then(then) : this;
        },

        /**
         * Adds a new navigation step for opening and evaluate an expression
         * against the DOM retrieved from the provided location.
         *
         * @param  String    location      The url to open
         * @param  function  fn            The function to be evaluated within current page DOM
         * @param  object    replacements  Optional replacements to performs, eg. for '%foo%' => {foo: 'bar'}
         * @return Casper
         * @see    Casper#evaluate
         * @see    Casper#open
         */
        thenOpenAndEvaluate: function(location, fn, replacements) {
            return this.thenOpen(location).thenEvaluate(fn, replacements);
        },

        /**
         * Changes the current viewport size.
         *
         * @param  Number  width   The viewport width, in pixels
         * @param  Number  height  The viewport height, in pixels
         * @return Casper
         */
        viewport: function(width, height) {
            if (!isType(width, "number") || !isType(height, "number") || width <= 0 || height <= 0) {
                throw new Error("Invalid viewport width/height set: " + width + 'x' + height);
            }
            this.page.viewportSize = {
                width: width,
                height: height
            };
            return this;
        },

        /**
         * Adds a new step that will wait for a given amount of time (expressed
         * in milliseconds) before processing an optional next one.
         *
         * @param  Number    timeout  The max amount of time to wait, in milliseconds
         * @param  Function  then     Next step to process (optional)
         * @return Casper
         */
        wait: function(timeout, then) {
            timeout = Number(timeout, 10);
            if (!isType(timeout, "number") || timeout < 1) {
                this.die("wait() only accepts a positive integer > 0 as a timeout value");
            }
            if (then && !isType(then, "function")) {
                this.die("wait() a step definition must be a function");
            }
            return this.then(function(self) {
                self.delayedExecution = true;
                var start = new Date().getTime();
                var interval = setInterval(function(self, then) {
                    if (new Date().getTime() - start > timeout) {
                        self.delayedExecution = false;
                        self.log("wait() finished wating for " + timeout + "ms.", "info");
                        if (then) {
                            self.then(then);
                        }
                        clearInterval(interval);
                    }
                }, 100, self, then);
            });
        },

        /**
         * Waits until a function returns true to process a next step.
         *
         * @param  Function  testFx     A function to be evaluated for returning condition satisfecit
         * @param  Function  then       The next step to perform (optional)
         * @param  Function  onTimeout  A callback function to call on timeout (optional)
         * @param  Number    timeout    The max amount of time to wait, in milliseconds (optional)
         * @return Casper
         */
        waitFor: function(testFx, then, onTimeout, timeout) {
            timeout = timeout ? timeout : this.defaultWaitTimeout;
            if (!isType(testFx, "function")) {
                this.die("waitFor() needs a test function");
            }
            if (then && !isType(then, "function")) {
                this.die("waitFor() next step definition must be a function");
            }
            this.delayedExecution = true;
            var start = new Date().getTime();
            var condition = false;
            var interval = setInterval(function(self, testFx, onTimeout) {
                if ((new Date().getTime() - start < timeout) && !condition) {
                    condition = testFx(self);
                } else {
                    self.delayedExecution = false;
                    if (!condition) {
                        self.log("Casper.waitFor() timeout", "warning");
                        if (isType(onTimeout, "function")) {
                            onTimeout(self);
                        } else {
                            self.die("Expired timeout, exiting.", "error");
                        }
                        clearInterval(interval);
                    } else {
                        self.log("waitFor() finished in " + (new Date().getTime() - start) + "ms.", "info");
                        if (then) {
                            self.then(then);
                        }
                        clearInterval(interval);
                    }
                }
            }, 100, this, testFx, onTimeout);
            return this;
        },

        /**
         * Waits until an element matching the provided CSS3 selector exists in
         * remote DOM to process a next step.
         *
         * @param  String    selector   A CSS3 selector
         * @param  Function  then       The next step to perform (optional)
         * @param  Function  onTimeout  A callback function to call on timeout (optional)
         * @param  Number    timeout    The max amount of time to wait, in milliseconds (optional)
         * @return Casper
         */
        waitForSelector: function(selector, then, onTimeout, timeout) {
            timeout = timeout ? timeout : this.defaultWaitTimeout;
            return this.waitFor(function(self) {
                return self.exists(selector);
            }, then, onTimeout, timeout);
        }
    };

    /**
     * Extends Casper's prototype with provided one.
     *
     * @param  Object  proto  Prototype methods to add to Casper
     */
    phantom.Casper.extend = function(proto) {
        if (!isType(proto, "object")) {
            throw "extends() only accept objects as prototypes";
        }
        mergeObjects(phantom.Casper.prototype, proto);
    };

    /**
     * Casper client-side helpers.
     */
    phantom.Casper.ClientUtils = function() {
        /**
         * Clicks on the DOM element behind the provided selector.
         *
         * @param  String  selector        A CSS3 selector to the element to click
         * @param  Boolean fallbackToHref  Whether to try to relocate to the value of any href attribute (default: true)
         * @return Boolean
         */
        this.click = function(selector, fallbackToHref) {
            fallbackToHref = typeof fallbackToHref === "undefined" ? true : !!fallbackToHref;
            var elem = this.findOne(selector);
            if (!elem) {
                return false;
            }
            var evt = document.createEvent("MouseEvents");
            evt.initMouseEvent("click", true, true, window, 1, 1, 1, 1, 1, false, false, false, false, 0, elem);
            if (elem.dispatchEvent(evt)) {
                return true;
            }
            if (fallbackToHref && elem.hasAttribute('href')) {
                document.location = elem.getAttribute('href');
                return true;
            }
            return false;
        };

        /**
         * Base64 encodes a string, even binary ones. Succeeds where
         * window.btoa() fails.
         *
         * @param  String  str
         * @return string
         */
        this.encode = function(str) {
            var CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
            var out = "", i = 0, len = str.length, c1, c2, c3;
            while (i < len) {
                c1 = str.charCodeAt(i++) & 0xff;
                if (i == len) {
                    out += CHARS.charAt(c1 >> 2);
                    out += CHARS.charAt((c1 & 0x3) << 4);
                    out += "==";
                    break;
                }
                c2 = str.charCodeAt(i++);
                if (i == len) {
                    out += CHARS.charAt(c1 >> 2);
                    out += CHARS.charAt(((c1 & 0x3)<< 4) | ((c2 & 0xF0) >> 4));
                    out += CHARS.charAt((c2 & 0xF) << 2);
                    out += "=";
                    break;
                }
                c3 = str.charCodeAt(i++);
                out += CHARS.charAt(c1 >> 2);
                out += CHARS.charAt(((c1 & 0x3) << 4) | ((c2 & 0xF0) >> 4));
                out += CHARS.charAt(((c2 & 0xF) << 2) | ((c3 & 0xC0) >> 6));
                out += CHARS.charAt(c3 & 0x3F);
            }
            return out;
        };

        /**
         * Checks if a given DOM element exists in remote page.
         *
         * @param  String  selector  CSS3 selector
         * @return Boolean
         */
        this.exists = function(selector) {
            try {
                return document.querySelectorAll(selector).length > 0;
            } catch (e) {
                return false;
            }
        };

        /**
         * Fetches innerText within the element(s) matching a given CSS3
         * selector.
         *
         * @param  String  selector  A CSS3 selector
         * @return String
         */
        this.fetchText = function(selector) {
            var text = '', elements = this.findAll(selector);
            if (elements && elements.length) {
                Array.prototype.forEach.call(elements, function(element) {
                    text += element.innerText;
                });
            }
            return text;
        };

        /**
         * Fills a form with provided field values, and optionnaly submits it.
         *
         * @param  HTMLElement|String  form    A form element, or a CSS3 selector to a form element
         * @param  Object              vals    Field values
         * @return Object                      An object containing setting result for each field, including file uploads
         */
        this.fill = function(form, vals) {
            var out = {
                errors: [],
                fields: [],
                files:  []
            };
            if (!(form instanceof HTMLElement) || typeof form === "string") {
                __utils__.log("attempting to fetch form element from selector: '" + form + "'", "info");
                try {
                    form = document.querySelector(form);
                } catch (e) {
                    if (e.name === "SYNTAX_ERR") {
                        out.errors.push("invalid form selector provided: '" + form + "'");
                        return out;
                    }
                }
            }
            if (!form) {
                out.errors.push("form not found");
                return out;
            }
            for (var name in vals) {
                if (!vals.hasOwnProperty(name)) {
                    continue;
                }
                var field = form.querySelectorAll('[name="' + name + '"]');
                var value = vals[name];
                if (!field) {
                    out.errors.push('no field named "' + name + '" in form');
                    continue;
                }
                try {
                    out.fields[name] = this.setField(field, value);
                } catch (err) {
                    if (err.name === "FileUploadError") {
                        out.files.push({
                            name: name,
                            path: err.path
                        });
                    } else {
                        throw err;
                    }
                }
            }
            return out;
        };

        /**
         * Finds all DOM elements matching by the provided selector.
         *
         * @param  String  selector  CSS3 selector
         * @return NodeList|undefined
         */
        this.findAll = function(selector) {
            try {
                return document.querySelectorAll(selector);
            } catch (e) {
                this.log('findAll(): invalid selector provided "' + selector + '":' + e, "error");
            }
        };

        /**
         * Finds a DOM element by the provided selector.
         *
         * @param  String  selector  CSS3 selector
         * @return HTMLElement|undefined
         */
        this.findOne = function(selector) {
            try {
                return document.querySelector(selector);
            } catch (e) {
                this.log('findOne(): invalid selector provided "' + selector + '":' + e, "errors");
            }
        };

        /**
         * Downloads a resource behind an url and returns its base64-encoded
         * contents.
         *
         * @param  String  url  The resource url
         * @return String       Base64 contents string
         */
        this.getBase64 = function(url) {
            return this.encode(this.getBinary(url));
        };

        /**
         * Retrieves string contents from a binary file behind an url. Silently
         * fails but log errors.
         *
         * @param  String  url
         * @return string
         */
        this.getBinary = function(url) {
            try {
                var xhr = new XMLHttpRequest();
                xhr.open("GET", url, false);
                xhr.overrideMimeType("text/plain; charset=x-user-defined");
                xhr.send(null);
                return xhr.responseText;
            } catch (e) {
                if (e.name === "NETWORK_ERR" && e.code === 101) {
                    this.log("unfortunately, casperjs cannot make cross domain ajax requests", "warning");
                }
                this.log("error while fetching " + url + ": " + e, "error");
                return "";
            }
        };

        /**
         * Logs a message.
         *
         * @param  String  message
         * @param  String  level
         */
        this.log = function(message, level) {
            console.log("[casper:" + (level || "debug") + "] " + message);
        };

        /**
         * Sets a field (or a set of fields) value. Fails silently, but log
         * error messages.
         *
         * @param  HTMLElement|NodeList  field  One or more element defining a field
         * @param  mixed                 value  The field value to set
         */
        this.setField = function(field, value) {
            var fields, out;
            value = value || "";
            if (field instanceof NodeList) {
                fields = field;
                field = fields[0];
            }
            if (!field instanceof HTMLElement) {
                this.log("invalid field type; only HTMLElement and NodeList are supported", "error");
            }
            this.log('set "' + field.getAttribute('name') + '" field value to ' + value, "debug");
            try {
                field.focus();
            } catch (e) {
                __utils__.log("Unable to focus() input field " + field.getAttribute('name') + ": " + e, "warning");
            }
            var nodeName = field.nodeName.toLowerCase();
            switch (nodeName) {
                case "input":
                    var type = field.getAttribute('type') || "text";
                    switch (type.toLowerCase()) {
                        case "color":
                        case "date":
                        case "datetime":
                        case "datetime-local":
                        case "email":
                        case "hidden":
                        case "month":
                        case "number":
                        case "password":
                        case "range":
                        case "search":
                        case "tel":
                        case "text":
                        case "time":
                        case "url":
                        case "week":
                            field.value = value;
                            break;
                        case "checkbox":
                            field.setAttribute('checked', value ? "checked" : "");
                            break;
                        case "file":
                            throw {
                                name:    "FileUploadError",
                                message: "file field must be filled using page.uploadFile",
                                path:    value
                            };
                        case "radio":
                            if (fields) {
                                Array.prototype.forEach.call(fields, function(e) {
                                    e.checked = (e.value === value);
                                });
                            } else {
                                out = 'provided radio elements are empty';
                            }
                            break;
                        default:
                            out = "unsupported input field type: " + type;
                            break;
                    }
                    break;
                case "select":
                case "textarea":
                    field.value = value;
                    break;
                default:
                    out = 'unsupported field type: ' + nodeName;
                    break;
            }
            try {
                field.blur();
            } catch (err) {
                __utils__.log("Unable to blur() input field " + field.getAttribute('name') + ": " + err, "warning");
            }
            return out;
        };
    };

    /**
     * This is a port of lime colorizer.
     * http://trac.symfony-project.org/browser/tools/lime/trunk/lib/lime.php)
     *
     * (c) Fabien Potencier, Symfony project, MIT license
     */
    phantom.Casper.Colorizer = function() {
        var options    = { bold: 1, underscore: 4, blink: 5, reverse: 7, conceal: 8 };
        var foreground = { black: 30, red: 31, green: 32, yellow: 33, blue: 34, magenta: 35, cyan: 36, white: 37 };
        var background = { black: 40, red: 41, green: 42, yellow: 43, blue: 44, magenta: 45, cyan: 46, white: 47 };
        var styles     = {
            'ERROR':     { bg: 'red', fg: 'white', bold: true },
            'INFO':      { fg: 'green', bold: true },
            'TRACE':     { fg: 'green', bold: true },
            'PARAMETER': { fg: 'cyan' },
            'COMMENT':   { fg: 'yellow' },
            'WARNING':   { fg: 'red', bold: true },
            'GREEN_BAR': { fg: 'white', bg: 'green', bold: true },
            'RED_BAR':   { fg: 'white', bg: 'red', bold: true },
            'INFO_BAR':  { fg: 'cyan', bold: true }
        };

        /**
         * Adds a style to provided text.
         *
         * @params  String  text
         * @params  String  styleName
         * @return  String
         */
        this.colorize = function(text, styleName) {
            if (styleName in styles) {
                return this.format(text, styles[styleName]);
            }
            return text;
        };

        /**
         * Formats a text using a style declaration object.
         *
         * @param  String  text
         * @param  Object  style
         * @return String
         */
        this.format = function(text, style) {
            if (typeof style !== "object") {
                return text;
            }
            var codes = [];
            if (style.fg && foreground[style.fg]) {
                codes.push(foreground[style.fg]);
            }
            if (style.bg && background[style.bg]) {
                codes.push(background[style.bg]);
            }
            for (var option in options) {
                if (style[option] === true) {
                    codes.push(options[option]);
                }
            }
            return "\033[" + codes.join(';') + 'm' + text + "\033[0m";
        };
    };

    /**
     * Casper tester: makes assertions, stores test results and display them.
     *
     */
    phantom.Casper.Tester = function(casper, options) {
        this.options = isType(options, "object") ? options : {};
        if (!casper instanceof phantom.Casper) {
            throw "phantom.Casper.Tester needs a phantom.Casper instance";
        }

        // locals
        var exporter = new phantom.Casper.XUnitExporter();
        var PASS = this.options.PASS || "PASS";
        var FAIL = this.options.FAIL || "FAIL";

        // properties
        this.testResults = {
            passed: 0,
            failed: 0
        };

        // methods
        /**
         * Asserts a condition resolves to true.
         *
         * @param  Boolean  condition
         * @param  String   message    Test description
         */
        this.assert = function(condition, message) {
            var status = PASS;
            if (condition === true) {
                style = 'INFO';
                this.testResults.passed++;
                exporter.addSuccess("unknown", message);
            } else {
                status = FAIL;
                style = 'RED_BAR';
                this.testResults.failed++;
                exporter.addFailure("unknown", message, 'test failed', "assert");
            }
            casper.echo([this.colorize(status, style), this.formatMessage(message)].join(' '));
        };

        /**
         * Asserts that two values are strictly equals.
         *
         * @param  Boolean  testValue  The value to test
         * @param  Boolean  expected   The expected value
         * @param  String   message    Test description
         */
        this.assertEquals = function(testValue, expected, message) {
            if (expected === testValue) {
                casper.echo(this.colorize(PASS, 'INFO') + ' ' + this.formatMessage(message));
                this.testResults.passed++;
                exporter.addSuccess("unknown", message);
            } else {
                casper.echo(this.colorize(FAIL, 'RED_BAR') + ' ' + this.formatMessage(message, 'WARNING'));
                this.comment('   got:      ' + testValue);
                this.comment('   expected: ' + expected);
                this.testResults.failed++;
                exporter.addFailure("unknown", message, "test failed; expected: " + expected + "; got: " + testValue, "assertEquals");
            }
        };

        /**
         * Asserts that a code evaluation in remote DOM resolves to true.
         *
         * @param  Function  fn         A function to be evaluated in remote DOM
         * @param  String    message    Test description
         */
        this.assertEval = function(fn, message) {
            return this.assert(casper.evaluate(fn), message);
        };

        /**
         * Asserts that the result of a code evaluation in remote DOM equals
         * an expected value.
         *
         * @param  Function fn         The function to be evaluated in remote DOM
         * @param  Boolean  expected   The expected value
         * @param  String   message    Test description
         */
        this.assertEvalEquals = function(fn, expected, message) {
            return this.assertEquals(casper.evaluate(fn), expected, message);
        };

        /**
         * Asserts that an element matching the provided CSS3 selector exists in
         * remote DOM.
         *
         * @param  String   selector   CSS3 selectore
         * @param  String   message    Test description
         */
        this.assertExists = function(selector, message) {
            return this.assert(casper.exists(selector), message);
        };

        /**
         * Asserts that a provided string matches a provided RegExp pattern.
         *
         * @param  String   subject    The string to test
         * @param  RegExp   pattern    A RegExp object instance
         * @param  String   message    Test description
         */
        this.assertMatch = function(subject, pattern, message) {
            if (pattern.test(subject)) {
                casper.echo(this.colorize(PASS, 'INFO') + ' ' + this.formatMessage(message));
                this.testResults.passed++;
                exporter.addSuccess("unknown", message);
            } else {
                casper.echo(this.colorize(FAIL, 'RED_BAR') + ' ' + this.formatMessage(message, 'WARNING'));
                this.comment('   subject: ' + subject);
                this.comment('   pattern: ' + pattern.toString());
                this.testResults.failed++;
                exporter.addFailure("unknown", message, "test failed; subject: " + subject + "; pattern: " + pattern.toString(), "assertMatch");
            }
        };

        /**
         * Asserts that the provided function called with the given parameters
         * will raise an exception.
         *
         * @param  Function  fn       The function to test
         * @param  Array     args     The arguments to pass to the function
         * @param  String    message  Test description
         */
        this.assertRaises = function(fn, args, message) {
            try {
                fn.apply(null, args);
                this.fail(message);
            } catch (e) {
                this.pass(message);
            }
        };

        /**
         * Asserts that at least an element matching the provided CSS3 selector
         * exists in remote DOM.
         *
         * @param  String   selector   A CSS3 selector string
         * @param  String   message    Test description
         */
        this.assertSelectorExists = function(selector, message) {
            return this.assert(this.exists(selector), message);
        };

        /**
         * Asserts that title of the remote page equals to the expected one.
         *
         * @param  String  expected   The expected title string
         * @param  String  message    Test description
         */
        this.assertTitle = function(expected, message) {
            return this.assertEquals(casper.getTitle(), expected, message);
        };

        /**
         * Asserts that the provided input is of the given type.
         *
         * @param  mixed   input    The value to test
         * @param  String  type     The javascript type name
         * @param  String  message  Test description
         */
        this.assertType = function(input, type, message) {
            return this.assertEquals(betterTypeOf(input), type, message);
        };

        /**
         * Asserts that a the current page url matches the provided RegExp
         * pattern.
         *
         * @param  RegExp   pattern    A RegExp object instance
         * @param  String   message    Test description
         */
        this.assertUrlMatch = function(pattern, message) {
            return this.assertMatch(casper.getCurrentUrl(), pattern, message);
        };

        /**
         * Render a colorized output. Basically a proxy method for
         * Casper.Colorizer#colorize()
         */
        this.colorize = function(message, style) {
            return casper.colorizer.colorize(message, style);
        };

        /**
         * Writes a comment-style formatted message to stdout.
         *
         * @param  String  message
         */
        this.comment = function(message) {
            casper.echo('# ' + message, 'COMMENT');
        };

        /**
         * Writes an error-style formatted message to stdout.
         *
         * @param  String  message
         */
        this.error = function(message) {
            casper.echo(message, 'ERROR');
        };

        /**
         * Adds a failed test entry to the stack.
         *
         * @param  String  message
         */
        this.fail = function(message) {
            this.assert(false, message);
        };

        /**
         * Formats a message to highlight some parts of it.
         *
         * @param  String  message
         * @param  String  style
         */
        this.formatMessage = function(message, style) {
            var parts = /([a-z0-9_\.]+\(\))(.*)/i.exec(message);
            if (!parts) {
                return message;
            }
            return this.colorize(parts[1], 'PARAMETER') + this.colorize(parts[2], style);
        };

        /**
         * Writes an info-style formatted message to stdout.
         *
         * @param  String  message
         */
        this.info = function(message) {
            casper.echo(message, 'PARAMETER');
        };

        /**
         * Adds a successful test entry to the stack.
         *
         * @param  String  message
         */
        this.pass = function(message) {
            this.assert(true, message);
        };

        /**
         * Render tests results, an optionnaly exit phantomjs.
         *
         * @param  Boolean  exit
         */
        this.renderResults = function(exit, status, save) {
            save = isType(save, "string") ? save : this.options.save;
            var total = this.testResults.passed + this.testResults.failed, statusText, style, result;
            if (this.testResults.failed > 0) {
                statusText = FAIL;
                style = 'RED_BAR';
            } else {
                statusText = PASS;
                style = 'GREEN_BAR';
            }
            result = statusText + ' ' + total + ' tests executed, ' + this.testResults.passed + ' passed, ' + this.testResults.failed + ' failed.';
            if (result.length < 80) {
                result += new Array(80 - result.length + 1).join(' ');
            }
            casper.echo(this.colorize(result, style));
            if (save && isType(require, "function")) {
                try {
                    require('fs').write(save, exporter.getXML(), 'w');
                    casper.echo('result log stored in ' + save, 'INFO');
                } catch (e) {
                    casper.echo('unable to write results to ' + save + '; ' + e, 'ERROR');
                }
            }
            if (exit === true) {
                casper.exit(status || 0);
            }
        };
    };

    /**
     * JUnit XML (xUnit) exporter for test results.
     *
     */
    phantom.Casper.XUnitExporter = function() {
        var node = function(name, attributes) {
            var node = document.createElement(name);
            for (var attrName in attributes) {
                var value = attributes[attrName];
                if (attributes.hasOwnProperty(attrName) && isType(attrName, "string")) {
                    node.setAttribute(attrName, value);
                }
            }
            return node;
        };

        var xml = node('testsuite');
        xml.toString = function() {
            return this.outerHTML; // ouch
        };

        /**
         * Adds a successful test result
         *
         * @param  String  classname
         * @param  String  name
         */
        this.addSuccess = function(classname, name) {
            xml.appendChild(node('testcase', {
                classname: classname,
                name:      name
            }));
        };

        /**
         * Adds a failed test result
         *
         * @param  String  classname
         * @param  String  name
         * @param  String  message
         * @param  String  type
         */
        this.addFailure = function(classname, name, message, type) {
            var fnode = node('testcase', {
                classname: classname,
                name:      name
            });
            var failure = node('failure', {
                type: type || "unknown"
            });
            failure.appendChild(document.createTextNode(message || "no message left"));
            fnode.appendChild(failure);
            xml.appendChild(fnode);
        };

        /**
         * Retrieves generated XML object - actually an HTMLElement.
         *
         * @return HTMLElement
         */
        this.getXML = function() {
            return xml;
        };
    };

    /**
     * Provides a better typeof operator equivalent, able to retrieve the array
     * type.
     *
     * @param  mixed  input
     * @return String
     * @see    http://javascriptweblog.wordpress.com/2011/08/08/fixing-the-javascript-typeof-operator/
     */
    function betterTypeOf(input) {
        try {
            return Object.prototype.toString.call(input).match(/^\[object\s(.*)\]$/)[1].toLowerCase();
        } catch (e) {
            return typeof input;
        }
    }

    /**
     * Creates a new WebPage instance for Casper use.
     *
     * @param  Casper  casper  A Casper instance
     * @return WebPage
     */
    function createPage(casper) {
        var page;
        if (phantom.version.major <= 1 && phantom.version.minor < 3 && isType(require, "function")) {
            page = new WebPage();
        } else {
            page = require('webpage').create();
        }
        page.onConsoleMessage = function(msg) {
            var level = "info", test = /^\[casper:(\w+)\]\s?(.*)/.exec(msg);
            if (test && test.length === 3) {
                level = test[1];
                msg = test[2];
            }
            casper.log(msg, level, "remote");
        };
        page.onLoadStarted = function() {
            casper.loadInProgress = true;
        };
        page.onLoadFinished = function(status) {
            if (status !== "success") {
                var message = 'Loading resource failed with status=' + status;
                if (casper.currentHTTPStatus) {
                    message += ' (HTTP ' + casper.currentHTTPStatus + ')';
                }
                message += ': ' + casper.requestUrl;
                casper.log(message, "warning");
                if (isType(casper.options.onLoadError, "function")) {
                    casper.options.onLoadError(casper, casper.requestUrl, status);
                }
            }
            if (casper.options.clientScripts) {
                if (betterTypeOf(casper.options.clientScripts) !== "array") {
                    casper.log("The clientScripts option must be an array", "error");
                } else {
                    for (var i = 0; i < casper.options.clientScripts.length; i++) {
                        var script = casper.options.clientScripts[i];
                        if (casper.page.injectJs(script)) {
                            casper.log('Automatically injected ' + script + ' client side', "debug");
                        } else {
                            casper.log('Failed injecting ' + script + ' client side', "warning");
                        }
                    }
                }
            }
            // Client utils injection
            var injected = page.evaluate(replaceFunctionPlaceholders(function() {
                eval("var ClientUtils = " + decodeURIComponent("%utils%"));
                __utils__ = new ClientUtils();
                return __utils__ instanceof ClientUtils;
            }, {
                utils: encodeURIComponent(phantom.Casper.ClientUtils.toString())
            }));
            if (!injected) {
                casper.log("Failed to inject Casper client-side utilities!", "warning");
            } else {
                casper.log("Successfully injected Casper client-side utilities", "debug");
            }
            // history
            casper.history.push(casper.getCurrentUrl());
            casper.loadInProgress = false;
        };
        page.onResourceReceived = function(resource) {
            if (resource.url === casper.requestUrl) {
                casper.currentHTTPStatus = resource.status;
                casper.currentUrl = resource.url;
            }
        };
        return page;
    }

    /**
     * Shorthands for checking if a value is of the given type. Can check for
     * arrays.
     *
     * @param  mixed   what      The value to check
     * @param  String  typeName  The type name ("string", "number", "function", etc.)
     * @return Boolean
     */
    function isType(what, typeName) {
        return betterTypeOf(what) === typeName;
    }

    /**
     * Checks if the provided var is a WebPage instance
     *
     * @param  mixed  what
     * @return Boolean
     */
    function isWebPage(what) {
        if (!what || !isType(what, "object")) {
            return false;
        }
        if (phantom.version.major <= 1 && phantom.version.minor < 3 && isType(require, "function")) {
            return what instanceof WebPage;
        } else {
            return what.toString().indexOf('WebPage(') === 0;
        }
    }

    /**
     * Object recursive merging utility.
     *
     * @param  Object  obj1  the destination object
     * @param  Object  obj2  the source object
     * @return Object
     */
    function mergeObjects(obj1, obj2) {
        for (var p in obj2) {
            try {
                if (obj2[p].constructor == Object) {
                    obj1[p] = mergeObjects(obj1[p], obj2[p]);
                } else {
                    obj1[p] = obj2[p];
                }
            } catch(e) {
              obj1[p] = obj2[p];
            }
        }
        return obj1;
    }

    /**
     * Replaces a function string contents with placeholders provided by an
     * Object.
     *
     * @param  Function  fn            The function
     * @param  Object    replacements  Object containing placeholder replacements
     * @return String                  A function string representation
     */
    function replaceFunctionPlaceholders(fn, replacements) {
        if (replacements && isType(replacements, "object")) {
            fn = fn.toString();
            for (var placeholder in replacements) {
                var match = '%' + placeholder + '%';
                do {
                    fn = fn.replace(match, replacements[placeholder]);
                } while(fn.indexOf(match) !== -1);
            }
        }
        return fn;
    }

    /*! Gibberish-AES 
    * A lightweight Javascript Libray for OpenSSL compatible AES CBC encryption.
    *
    * Author: Mark Percival
    * Email: mark@mpercival.com
    * Copyright: Mark Percival - http://mpercival.com 2008
    *
    * With thanks to:
    * Josh Davis - http://www.josh-davis.org/ecmaScrypt
    * Chris Veness - http://www.movable-type.co.uk/scripts/aes.html
    * Michel I. Gallant - http://www.jensign.com/
    *
    * License: MIT
    *
    * Usage: GibberishAES.enc("secret", "password")
    * Outputs: AES Encrypted text encoded in Base64
    */


    var GibberishAES = (function(){
        var Nr = 14,
        /* Default to 256 Bit Encryption */
        Nk = 8,
        Decrypt = false,

        enc_utf8 = function(s)
        {
            try {
                return unescape(encodeURIComponent(s));
            }
            catch(e) {
                throw 'Error on UTF-8 encode';
            }
        },

        dec_utf8 = function(s)
        {
            try {
                return decodeURIComponent(escape(s));
            }
            catch(e) {
                throw ('Bad Key');
            }
        },

        padBlock = function(byteArr)
        {
            var array = [], cpad, i;
            if (byteArr.length < 16) {
                cpad = 16 - byteArr.length;
                array = [cpad, cpad, cpad, cpad, cpad, cpad, cpad, cpad, cpad, cpad, cpad, cpad, cpad, cpad, cpad, cpad];
            }
            for (i = 0; i < byteArr.length; i++)
            {
                array[i] = byteArr[i];
            }
            return array;
        },

        block2s = function(block, lastBlock)
        {
            var string = '', padding, i;
            if (lastBlock) {
                padding = block[15];
                if (padding > 16) {
                    throw ('Decryption error: Maybe bad key');
                }
                if (padding == 16) {
                    return '';
                }
                for (i = 0; i < 16 - padding; i++) {
                    string += String.fromCharCode(block[i]);
                }
            } else {
                for (i = 0; i < 16; i++) {
                    string += String.fromCharCode(block[i]);
                }
            }
            return string;
        },

        a2h = function(numArr)
        {
            var string = '', i;
            for (i = 0; i < numArr.length; i++) {
                string += (numArr[i] < 16 ? '0': '') + numArr[i].toString(16);
            }
            return string;
        },

        h2a = function(s)
        {
            var ret = [];
            s.replace(/(..)/g,
            function(s) {
                ret.push(parseInt(s, 16));
            });
            return ret;
        },

        s2a = function(string) {
            string = enc_utf8(string);
            var array = [], i;
            for (i = 0; i < string.length; i++)
            {
                array[i] = string.charCodeAt(i);
            }
            return array;
        },

        size = function(newsize)
        {
            switch (newsize)
            {
            case 128:
                Nr = 10;
                Nk = 4;
                break;
            case 192:
                Nr = 12;
                Nk = 6;
                break;
            case 256:
                Nr = 14;
                Nk = 8;
                break;
            default:
                throw ('Invalid Key Size Specified:' + newsize);
            }
        },

        randArr = function(num) {
            var result = [], i;
            for (i = 0; i < num; i++) {
                result = result.concat(Math.floor(Math.random() * 256));
            }
            return result;
        },

        openSSLKey = function(passwordArr, saltArr) {
            // Number of rounds depends on the size of the AES in use
            // 3 rounds for 256
            //        2 rounds for the key, 1 for the IV
            // 2 rounds for 128
            //        1 round for the key, 1 round for the IV
            // 3 rounds for 192 since it's not evenly divided by 128 bits
            var rounds = Nr >= 12 ? 3: 2,
            key = [],
            iv = [],
            md5_hash = [],
            result = [],
            data00 = passwordArr.concat(saltArr),
            i;
            md5_hash[0] = GibberishAES.Hash.MD5(data00);
            result = md5_hash[0];
            for (i = 1; i < rounds; i++) {
                md5_hash[i] = GibberishAES.Hash.MD5(md5_hash[i - 1].concat(data00));
                result = result.concat(md5_hash[i]);
            }
            key = result.slice(0, 4 * Nk);
            iv = result.slice(4 * Nk, 4 * Nk + 16);
            return {
                key: key,
                iv: iv
            };
        },

        rawEncrypt = function(plaintext, key, iv) {
            // plaintext, key and iv as byte arrays
            key = expandKey(key);
            var numBlocks = Math.ceil(plaintext.length / 16),
            blocks = [],
            i,
            cipherBlocks = [];
            for (i = 0; i < numBlocks; i++) {
                blocks[i] = padBlock(plaintext.slice(i * 16, i * 16 + 16));
            }
            if (plaintext.length % 16 === 0) {
                blocks.push([16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16]);
                // CBC OpenSSL padding scheme
                numBlocks++;
            }
            for (i = 0; i < blocks.length; i++) {
                blocks[i] = (i === 0) ? xorBlocks(blocks[i], iv) : xorBlocks(blocks[i], cipherBlocks[i - 1]);
                cipherBlocks[i] = encryptBlock(blocks[i], key);
            }
            return cipherBlocks;
        },

        rawDecrypt = function(cryptArr, key, iv, binary) {
            //  cryptArr, key and iv as byte arrays
            key = expandKey(key);
            var numBlocks = cryptArr.length / 16,
            cipherBlocks = [],
            i,
            plainBlocks = [],
            string = '';
            for (i = 0; i < numBlocks; i++) {
                cipherBlocks.push(cryptArr.slice(i * 16, (i + 1) * 16));
            }
            for (i = cipherBlocks.length - 1; i >= 0; i--) {
                plainBlocks[i] = decryptBlock(cipherBlocks[i], key);
                plainBlocks[i] = (i === 0) ? xorBlocks(plainBlocks[i], iv) : xorBlocks(plainBlocks[i], cipherBlocks[i - 1]);
            }
            for (i = 0; i < numBlocks - 1; i++) {
                string += block2s(plainBlocks[i]);
            }
            string += block2s(plainBlocks[i], true);
            return binary ? string : dec_utf8(string); 
        },

        encryptBlock = function(block, words) {
            Decrypt = false;
            var state = addRoundKey(block, words, 0),
            round;
            for (round = 1; round < (Nr + 1); round++) {
                state = subBytes(state);
                state = shiftRows(state);
                if (round < Nr) {
                    state = mixColumns(state);
                }
                //last round? don't mixColumns
                state = addRoundKey(state, words, round);
            }

            return state;
        },

        decryptBlock = function(block, words) {
            Decrypt = true;
            var state = addRoundKey(block, words, Nr),
            round;
            for (round = Nr - 1; round > -1; round--) {
                state = shiftRows(state);
                state = subBytes(state);
                state = addRoundKey(state, words, round);
                if (round > 0) {
                    state = mixColumns(state);
                }
                //last round? don't mixColumns
            }

            return state;
        },

        subBytes = function(state) {
            var S = Decrypt ? SBoxInv: SBox,
            temp = [],
            i;
            for (i = 0; i < 16; i++) {
                temp[i] = S[state[i]];
            }
            return temp;
        },

        shiftRows = function(state) {
            var temp = [],
            shiftBy = Decrypt ? [0, 13, 10, 7, 4, 1, 14, 11, 8, 5, 2, 15, 12, 9, 6, 3] : [0, 5, 10, 15, 4, 9, 14, 3, 8, 13, 2, 7, 12, 1, 6, 11],
            i;
            for (i = 0; i < 16; i++) {
                temp[i] = state[shiftBy[i]];
            }
            return temp;
        },

        mixColumns = function(state) {
            var t = [],
            c;
            if (!Decrypt) {
                for (c = 0; c < 4; c++) {
                    t[c * 4] = G2X[state[c * 4]] ^ G3X[state[1 + c * 4]] ^ state[2 + c * 4] ^ state[3 + c * 4];
                    t[1 + c * 4] = state[c * 4] ^ G2X[state[1 + c * 4]] ^ G3X[state[2 + c * 4]] ^ state[3 + c * 4];
                    t[2 + c * 4] = state[c * 4] ^ state[1 + c * 4] ^ G2X[state[2 + c * 4]] ^ G3X[state[3 + c * 4]];
                    t[3 + c * 4] = G3X[state[c * 4]] ^ state[1 + c * 4] ^ state[2 + c * 4] ^ G2X[state[3 + c * 4]];
                }
            }else {
                for (c = 0; c < 4; c++) {
                    t[c*4] = GEX[state[c*4]] ^ GBX[state[1+c*4]] ^ GDX[state[2+c*4]] ^ G9X[state[3+c*4]];
                    t[1+c*4] = G9X[state[c*4]] ^ GEX[state[1+c*4]] ^ GBX[state[2+c*4]] ^ GDX[state[3+c*4]];
                    t[2+c*4] = GDX[state[c*4]] ^ G9X[state[1+c*4]] ^ GEX[state[2+c*4]] ^ GBX[state[3+c*4]];
                    t[3+c*4] = GBX[state[c*4]] ^ GDX[state[1+c*4]] ^ G9X[state[2+c*4]] ^ GEX[state[3+c*4]];
                }
            }
            
            return t;
        },

        addRoundKey = function(state, words, round) {
            var temp = [],
            i;
            for (i = 0; i < 16; i++) {
                temp[i] = state[i] ^ words[round][i];
            }
            return temp;
        },

        xorBlocks = function(block1, block2) {
            var temp = [],
            i;
            for (i = 0; i < 16; i++) {
                temp[i] = block1[i] ^ block2[i];
            }
            return temp;
        },

        expandKey = function(key) {
            // Expects a 1d number array
            var w = [],
            temp = [],
            i,
            r,
            t,
            flat = [],
            j;

            for (i = 0; i < Nk; i++) {
                r = [key[4 * i], key[4 * i + 1], key[4 * i + 2], key[4 * i + 3]];
                w[i] = r;
            }

            for (i = Nk; i < (4 * (Nr + 1)); i++) {
                w[i] = [];
                for (t = 0; t < 4; t++) {
                    temp[t] = w[i - 1][t];
                }
                if (i % Nk === 0) {
                    temp = subWord(rotWord(temp));
                    temp[0] ^= Rcon[i / Nk - 1];
                } else if (Nk > 6 && i % Nk == 4) {
                    temp = subWord(temp);
                }
                for (t = 0; t < 4; t++) {
                    w[i][t] = w[i - Nk][t] ^ temp[t];
                }
            }
            for (i = 0; i < (Nr + 1); i++) {
                flat[i] = [];
                for (j = 0; j < 4; j++) {
                    flat[i].push(w[i * 4 + j][0], w[i * 4 + j][1], w[i * 4 + j][2], w[i * 4 + j][3]);
                }
            }
            return flat;
        },

        subWord = function(w) {
            // apply SBox to 4-byte word w
            for (var i = 0; i < 4; i++) {
                w[i] = SBox[w[i]];
            }
            return w;
        },

        rotWord = function(w) {
            // rotate 4-byte word w left by one byte
            var tmp = w[0],
            i;
            for (i = 0; i < 4; i++) {
                w[i] = w[i + 1];
            }
            w[3] = tmp;
            return w;
        },


        // S-box
        SBox = [
        99, 124, 119, 123, 242, 107, 111, 197, 48, 1, 103, 43, 254, 215, 171,
        118, 202, 130, 201, 125, 250, 89, 71, 240, 173, 212, 162, 175, 156, 164,
        114, 192, 183, 253, 147, 38, 54, 63, 247, 204, 52, 165, 229, 241, 113,
        216, 49, 21, 4, 199, 35, 195, 24, 150, 5, 154, 7, 18, 128, 226,
        235, 39, 178, 117, 9, 131, 44, 26, 27, 110, 90, 160, 82, 59, 214,
        179, 41, 227, 47, 132, 83, 209, 0, 237, 32, 252, 177, 91, 106, 203,
        190, 57, 74, 76, 88, 207, 208, 239, 170, 251, 67, 77, 51, 133, 69,
        249, 2, 127, 80, 60, 159, 168, 81, 163, 64, 143, 146, 157, 56, 245,
        188, 182, 218, 33, 16, 255, 243, 210, 205, 12, 19, 236, 95, 151, 68,
        23, 196, 167, 126, 61, 100, 93, 25, 115, 96, 129, 79, 220, 34, 42,
        144, 136, 70, 238, 184, 20, 222, 94, 11, 219, 224, 50, 58, 10, 73,
        6, 36, 92, 194, 211, 172, 98, 145, 149, 228, 121, 231, 200, 55, 109,
        141, 213, 78, 169, 108, 86, 244, 234, 101, 122, 174, 8, 186, 120, 37,
        46, 28, 166, 180, 198, 232, 221, 116, 31, 75, 189, 139, 138, 112, 62,
        181, 102, 72, 3, 246, 14, 97, 53, 87, 185, 134, 193, 29, 158, 225,
        248, 152, 17, 105, 217, 142, 148, 155, 30, 135, 233, 206, 85, 40, 223,
        140, 161, 137, 13, 191, 230, 66, 104, 65, 153, 45, 15, 176, 84, 187,
        22],

        // Precomputed lookup table for the inverse SBox
        SBoxInv = [
        82, 9, 106, 213, 48, 54, 165, 56, 191, 64, 163, 158, 129, 243, 215,
        251, 124, 227, 57, 130, 155, 47, 255, 135, 52, 142, 67, 68, 196, 222,
        233, 203, 84, 123, 148, 50, 166, 194, 35, 61, 238, 76, 149, 11, 66,
        250, 195, 78, 8, 46, 161, 102, 40, 217, 36, 178, 118, 91, 162, 73,
        109, 139, 209, 37, 114, 248, 246, 100, 134, 104, 152, 22, 212, 164, 92,
        204, 93, 101, 182, 146, 108, 112, 72, 80, 253, 237, 185, 218, 94, 21,
        70, 87, 167, 141, 157, 132, 144, 216, 171, 0, 140, 188, 211, 10, 247,
        228, 88, 5, 184, 179, 69, 6, 208, 44, 30, 143, 202, 63, 15, 2,
        193, 175, 189, 3, 1, 19, 138, 107, 58, 145, 17, 65, 79, 103, 220,
        234, 151, 242, 207, 206, 240, 180, 230, 115, 150, 172, 116, 34, 231, 173,
        53, 133, 226, 249, 55, 232, 28, 117, 223, 110, 71, 241, 26, 113, 29,
        41, 197, 137, 111, 183, 98, 14, 170, 24, 190, 27, 252, 86, 62, 75,
        198, 210, 121, 32, 154, 219, 192, 254, 120, 205, 90, 244, 31, 221, 168,
        51, 136, 7, 199, 49, 177, 18, 16, 89, 39, 128, 236, 95, 96, 81,
        127, 169, 25, 181, 74, 13, 45, 229, 122, 159, 147, 201, 156, 239, 160,
        224, 59, 77, 174, 42, 245, 176, 200, 235, 187, 60, 131, 83, 153, 97,
        23, 43, 4, 126, 186, 119, 214, 38, 225, 105, 20, 99, 85, 33, 12,
        125],
        // Rijndael Rcon
        Rcon = [1, 2, 4, 8, 16, 32, 64, 128, 27, 54, 108, 216, 171, 77, 154, 47, 94,
        188, 99, 198, 151, 53, 106, 212, 179, 125, 250, 239, 197, 145],

        G2X = [
        0x00, 0x02, 0x04, 0x06, 0x08, 0x0a, 0x0c, 0x0e, 0x10, 0x12, 0x14, 0x16,
        0x18, 0x1a, 0x1c, 0x1e, 0x20, 0x22, 0x24, 0x26, 0x28, 0x2a, 0x2c, 0x2e,
        0x30, 0x32, 0x34, 0x36, 0x38, 0x3a, 0x3c, 0x3e, 0x40, 0x42, 0x44, 0x46,
        0x48, 0x4a, 0x4c, 0x4e, 0x50, 0x52, 0x54, 0x56, 0x58, 0x5a, 0x5c, 0x5e,
        0x60, 0x62, 0x64, 0x66, 0x68, 0x6a, 0x6c, 0x6e, 0x70, 0x72, 0x74, 0x76,
        0x78, 0x7a, 0x7c, 0x7e, 0x80, 0x82, 0x84, 0x86, 0x88, 0x8a, 0x8c, 0x8e,
        0x90, 0x92, 0x94, 0x96, 0x98, 0x9a, 0x9c, 0x9e, 0xa0, 0xa2, 0xa4, 0xa6,
        0xa8, 0xaa, 0xac, 0xae, 0xb0, 0xb2, 0xb4, 0xb6, 0xb8, 0xba, 0xbc, 0xbe,
        0xc0, 0xc2, 0xc4, 0xc6, 0xc8, 0xca, 0xcc, 0xce, 0xd0, 0xd2, 0xd4, 0xd6,
        0xd8, 0xda, 0xdc, 0xde, 0xe0, 0xe2, 0xe4, 0xe6, 0xe8, 0xea, 0xec, 0xee,
        0xf0, 0xf2, 0xf4, 0xf6, 0xf8, 0xfa, 0xfc, 0xfe, 0x1b, 0x19, 0x1f, 0x1d,
        0x13, 0x11, 0x17, 0x15, 0x0b, 0x09, 0x0f, 0x0d, 0x03, 0x01, 0x07, 0x05,
        0x3b, 0x39, 0x3f, 0x3d, 0x33, 0x31, 0x37, 0x35, 0x2b, 0x29, 0x2f, 0x2d,
        0x23, 0x21, 0x27, 0x25, 0x5b, 0x59, 0x5f, 0x5d, 0x53, 0x51, 0x57, 0x55,
        0x4b, 0x49, 0x4f, 0x4d, 0x43, 0x41, 0x47, 0x45, 0x7b, 0x79, 0x7f, 0x7d,
        0x73, 0x71, 0x77, 0x75, 0x6b, 0x69, 0x6f, 0x6d, 0x63, 0x61, 0x67, 0x65,
        0x9b, 0x99, 0x9f, 0x9d, 0x93, 0x91, 0x97, 0x95, 0x8b, 0x89, 0x8f, 0x8d,
        0x83, 0x81, 0x87, 0x85, 0xbb, 0xb9, 0xbf, 0xbd, 0xb3, 0xb1, 0xb7, 0xb5,
        0xab, 0xa9, 0xaf, 0xad, 0xa3, 0xa1, 0xa7, 0xa5, 0xdb, 0xd9, 0xdf, 0xdd,
        0xd3, 0xd1, 0xd7, 0xd5, 0xcb, 0xc9, 0xcf, 0xcd, 0xc3, 0xc1, 0xc7, 0xc5,
        0xfb, 0xf9, 0xff, 0xfd, 0xf3, 0xf1, 0xf7, 0xf5, 0xeb, 0xe9, 0xef, 0xed,
        0xe3, 0xe1, 0xe7, 0xe5
        ],

        G3X = [
        0x00, 0x03, 0x06, 0x05, 0x0c, 0x0f, 0x0a, 0x09, 0x18, 0x1b, 0x1e, 0x1d,
        0x14, 0x17, 0x12, 0x11, 0x30, 0x33, 0x36, 0x35, 0x3c, 0x3f, 0x3a, 0x39,
        0x28, 0x2b, 0x2e, 0x2d, 0x24, 0x27, 0x22, 0x21, 0x60, 0x63, 0x66, 0x65,
        0x6c, 0x6f, 0x6a, 0x69, 0x78, 0x7b, 0x7e, 0x7d, 0x74, 0x77, 0x72, 0x71,
        0x50, 0x53, 0x56, 0x55, 0x5c, 0x5f, 0x5a, 0x59, 0x48, 0x4b, 0x4e, 0x4d,
        0x44, 0x47, 0x42, 0x41, 0xc0, 0xc3, 0xc6, 0xc5, 0xcc, 0xcf, 0xca, 0xc9,
        0xd8, 0xdb, 0xde, 0xdd, 0xd4, 0xd7, 0xd2, 0xd1, 0xf0, 0xf3, 0xf6, 0xf5,
        0xfc, 0xff, 0xfa, 0xf9, 0xe8, 0xeb, 0xee, 0xed, 0xe4, 0xe7, 0xe2, 0xe1,
        0xa0, 0xa3, 0xa6, 0xa5, 0xac, 0xaf, 0xaa, 0xa9, 0xb8, 0xbb, 0xbe, 0xbd,
        0xb4, 0xb7, 0xb2, 0xb1, 0x90, 0x93, 0x96, 0x95, 0x9c, 0x9f, 0x9a, 0x99,
        0x88, 0x8b, 0x8e, 0x8d, 0x84, 0x87, 0x82, 0x81, 0x9b, 0x98, 0x9d, 0x9e,
        0x97, 0x94, 0x91, 0x92, 0x83, 0x80, 0x85, 0x86, 0x8f, 0x8c, 0x89, 0x8a,
        0xab, 0xa8, 0xad, 0xae, 0xa7, 0xa4, 0xa1, 0xa2, 0xb3, 0xb0, 0xb5, 0xb6,
        0xbf, 0xbc, 0xb9, 0xba, 0xfb, 0xf8, 0xfd, 0xfe, 0xf7, 0xf4, 0xf1, 0xf2,
        0xe3, 0xe0, 0xe5, 0xe6, 0xef, 0xec, 0xe9, 0xea, 0xcb, 0xc8, 0xcd, 0xce,
        0xc7, 0xc4, 0xc1, 0xc2, 0xd3, 0xd0, 0xd5, 0xd6, 0xdf, 0xdc, 0xd9, 0xda,
        0x5b, 0x58, 0x5d, 0x5e, 0x57, 0x54, 0x51, 0x52, 0x43, 0x40, 0x45, 0x46,
        0x4f, 0x4c, 0x49, 0x4a, 0x6b, 0x68, 0x6d, 0x6e, 0x67, 0x64, 0x61, 0x62,
        0x73, 0x70, 0x75, 0x76, 0x7f, 0x7c, 0x79, 0x7a, 0x3b, 0x38, 0x3d, 0x3e,
        0x37, 0x34, 0x31, 0x32, 0x23, 0x20, 0x25, 0x26, 0x2f, 0x2c, 0x29, 0x2a,
        0x0b, 0x08, 0x0d, 0x0e, 0x07, 0x04, 0x01, 0x02, 0x13, 0x10, 0x15, 0x16,
        0x1f, 0x1c, 0x19, 0x1a
        ],

        G9X = [
        0x00, 0x09, 0x12, 0x1b, 0x24, 0x2d, 0x36, 0x3f, 0x48, 0x41, 0x5a, 0x53,
        0x6c, 0x65, 0x7e, 0x77, 0x90, 0x99, 0x82, 0x8b, 0xb4, 0xbd, 0xa6, 0xaf,
        0xd8, 0xd1, 0xca, 0xc3, 0xfc, 0xf5, 0xee, 0xe7, 0x3b, 0x32, 0x29, 0x20,
        0x1f, 0x16, 0x0d, 0x04, 0x73, 0x7a, 0x61, 0x68, 0x57, 0x5e, 0x45, 0x4c,
        0xab, 0xa2, 0xb9, 0xb0, 0x8f, 0x86, 0x9d, 0x94, 0xe3, 0xea, 0xf1, 0xf8,
        0xc7, 0xce, 0xd5, 0xdc, 0x76, 0x7f, 0x64, 0x6d, 0x52, 0x5b, 0x40, 0x49,
        0x3e, 0x37, 0x2c, 0x25, 0x1a, 0x13, 0x08, 0x01, 0xe6, 0xef, 0xf4, 0xfd,
        0xc2, 0xcb, 0xd0, 0xd9, 0xae, 0xa7, 0xbc, 0xb5, 0x8a, 0x83, 0x98, 0x91,
        0x4d, 0x44, 0x5f, 0x56, 0x69, 0x60, 0x7b, 0x72, 0x05, 0x0c, 0x17, 0x1e,
        0x21, 0x28, 0x33, 0x3a, 0xdd, 0xd4, 0xcf, 0xc6, 0xf9, 0xf0, 0xeb, 0xe2,
        0x95, 0x9c, 0x87, 0x8e, 0xb1, 0xb8, 0xa3, 0xaa, 0xec, 0xe5, 0xfe, 0xf7,
        0xc8, 0xc1, 0xda, 0xd3, 0xa4, 0xad, 0xb6, 0xbf, 0x80, 0x89, 0x92, 0x9b,
        0x7c, 0x75, 0x6e, 0x67, 0x58, 0x51, 0x4a, 0x43, 0x34, 0x3d, 0x26, 0x2f,
        0x10, 0x19, 0x02, 0x0b, 0xd7, 0xde, 0xc5, 0xcc, 0xf3, 0xfa, 0xe1, 0xe8,
        0x9f, 0x96, 0x8d, 0x84, 0xbb, 0xb2, 0xa9, 0xa0, 0x47, 0x4e, 0x55, 0x5c,
        0x63, 0x6a, 0x71, 0x78, 0x0f, 0x06, 0x1d, 0x14, 0x2b, 0x22, 0x39, 0x30,
        0x9a, 0x93, 0x88, 0x81, 0xbe, 0xb7, 0xac, 0xa5, 0xd2, 0xdb, 0xc0, 0xc9,
        0xf6, 0xff, 0xe4, 0xed, 0x0a, 0x03, 0x18, 0x11, 0x2e, 0x27, 0x3c, 0x35,
        0x42, 0x4b, 0x50, 0x59, 0x66, 0x6f, 0x74, 0x7d, 0xa1, 0xa8, 0xb3, 0xba,
        0x85, 0x8c, 0x97, 0x9e, 0xe9, 0xe0, 0xfb, 0xf2, 0xcd, 0xc4, 0xdf, 0xd6,
        0x31, 0x38, 0x23, 0x2a, 0x15, 0x1c, 0x07, 0x0e, 0x79, 0x70, 0x6b, 0x62,
        0x5d, 0x54, 0x4f, 0x46
        ],

        GBX = [
        0x00, 0x0b, 0x16, 0x1d, 0x2c, 0x27, 0x3a, 0x31, 0x58, 0x53, 0x4e, 0x45,
        0x74, 0x7f, 0x62, 0x69, 0xb0, 0xbb, 0xa6, 0xad, 0x9c, 0x97, 0x8a, 0x81,
        0xe8, 0xe3, 0xfe, 0xf5, 0xc4, 0xcf, 0xd2, 0xd9, 0x7b, 0x70, 0x6d, 0x66,
        0x57, 0x5c, 0x41, 0x4a, 0x23, 0x28, 0x35, 0x3e, 0x0f, 0x04, 0x19, 0x12,
        0xcb, 0xc0, 0xdd, 0xd6, 0xe7, 0xec, 0xf1, 0xfa, 0x93, 0x98, 0x85, 0x8e,
        0xbf, 0xb4, 0xa9, 0xa2, 0xf6, 0xfd, 0xe0, 0xeb, 0xda, 0xd1, 0xcc, 0xc7,
        0xae, 0xa5, 0xb8, 0xb3, 0x82, 0x89, 0x94, 0x9f, 0x46, 0x4d, 0x50, 0x5b,
        0x6a, 0x61, 0x7c, 0x77, 0x1e, 0x15, 0x08, 0x03, 0x32, 0x39, 0x24, 0x2f,
        0x8d, 0x86, 0x9b, 0x90, 0xa1, 0xaa, 0xb7, 0xbc, 0xd5, 0xde, 0xc3, 0xc8,
        0xf9, 0xf2, 0xef, 0xe4, 0x3d, 0x36, 0x2b, 0x20, 0x11, 0x1a, 0x07, 0x0c,
        0x65, 0x6e, 0x73, 0x78, 0x49, 0x42, 0x5f, 0x54, 0xf7, 0xfc, 0xe1, 0xea,
        0xdb, 0xd0, 0xcd, 0xc6, 0xaf, 0xa4, 0xb9, 0xb2, 0x83, 0x88, 0x95, 0x9e,
        0x47, 0x4c, 0x51, 0x5a, 0x6b, 0x60, 0x7d, 0x76, 0x1f, 0x14, 0x09, 0x02,
        0x33, 0x38, 0x25, 0x2e, 0x8c, 0x87, 0x9a, 0x91, 0xa0, 0xab, 0xb6, 0xbd,
        0xd4, 0xdf, 0xc2, 0xc9, 0xf8, 0xf3, 0xee, 0xe5, 0x3c, 0x37, 0x2a, 0x21,
        0x10, 0x1b, 0x06, 0x0d, 0x64, 0x6f, 0x72, 0x79, 0x48, 0x43, 0x5e, 0x55,
        0x01, 0x0a, 0x17, 0x1c, 0x2d, 0x26, 0x3b, 0x30, 0x59, 0x52, 0x4f, 0x44,
        0x75, 0x7e, 0x63, 0x68, 0xb1, 0xba, 0xa7, 0xac, 0x9d, 0x96, 0x8b, 0x80,
        0xe9, 0xe2, 0xff, 0xf4, 0xc5, 0xce, 0xd3, 0xd8, 0x7a, 0x71, 0x6c, 0x67,
        0x56, 0x5d, 0x40, 0x4b, 0x22, 0x29, 0x34, 0x3f, 0x0e, 0x05, 0x18, 0x13,
        0xca, 0xc1, 0xdc, 0xd7, 0xe6, 0xed, 0xf0, 0xfb, 0x92, 0x99, 0x84, 0x8f,
        0xbe, 0xb5, 0xa8, 0xa3
        ],

        GDX = [
        0x00, 0x0d, 0x1a, 0x17, 0x34, 0x39, 0x2e, 0x23, 0x68, 0x65, 0x72, 0x7f,
        0x5c, 0x51, 0x46, 0x4b, 0xd0, 0xdd, 0xca, 0xc7, 0xe4, 0xe9, 0xfe, 0xf3,
        0xb8, 0xb5, 0xa2, 0xaf, 0x8c, 0x81, 0x96, 0x9b, 0xbb, 0xb6, 0xa1, 0xac,
        0x8f, 0x82, 0x95, 0x98, 0xd3, 0xde, 0xc9, 0xc4, 0xe7, 0xea, 0xfd, 0xf0,
        0x6b, 0x66, 0x71, 0x7c, 0x5f, 0x52, 0x45, 0x48, 0x03, 0x0e, 0x19, 0x14,
        0x37, 0x3a, 0x2d, 0x20, 0x6d, 0x60, 0x77, 0x7a, 0x59, 0x54, 0x43, 0x4e,
        0x05, 0x08, 0x1f, 0x12, 0x31, 0x3c, 0x2b, 0x26, 0xbd, 0xb0, 0xa7, 0xaa,
        0x89, 0x84, 0x93, 0x9e, 0xd5, 0xd8, 0xcf, 0xc2, 0xe1, 0xec, 0xfb, 0xf6,
        0xd6, 0xdb, 0xcc, 0xc1, 0xe2, 0xef, 0xf8, 0xf5, 0xbe, 0xb3, 0xa4, 0xa9,
        0x8a, 0x87, 0x90, 0x9d, 0x06, 0x0b, 0x1c, 0x11, 0x32, 0x3f, 0x28, 0x25,
        0x6e, 0x63, 0x74, 0x79, 0x5a, 0x57, 0x40, 0x4d, 0xda, 0xd7, 0xc0, 0xcd,
        0xee, 0xe3, 0xf4, 0xf9, 0xb2, 0xbf, 0xa8, 0xa5, 0x86, 0x8b, 0x9c, 0x91,
        0x0a, 0x07, 0x10, 0x1d, 0x3e, 0x33, 0x24, 0x29, 0x62, 0x6f, 0x78, 0x75,
        0x56, 0x5b, 0x4c, 0x41, 0x61, 0x6c, 0x7b, 0x76, 0x55, 0x58, 0x4f, 0x42,
        0x09, 0x04, 0x13, 0x1e, 0x3d, 0x30, 0x27, 0x2a, 0xb1, 0xbc, 0xab, 0xa6,
        0x85, 0x88, 0x9f, 0x92, 0xd9, 0xd4, 0xc3, 0xce, 0xed, 0xe0, 0xf7, 0xfa,
        0xb7, 0xba, 0xad, 0xa0, 0x83, 0x8e, 0x99, 0x94, 0xdf, 0xd2, 0xc5, 0xc8,
        0xeb, 0xe6, 0xf1, 0xfc, 0x67, 0x6a, 0x7d, 0x70, 0x53, 0x5e, 0x49, 0x44,
        0x0f, 0x02, 0x15, 0x18, 0x3b, 0x36, 0x21, 0x2c, 0x0c, 0x01, 0x16, 0x1b,
        0x38, 0x35, 0x22, 0x2f, 0x64, 0x69, 0x7e, 0x73, 0x50, 0x5d, 0x4a, 0x47,
        0xdc, 0xd1, 0xc6, 0xcb, 0xe8, 0xe5, 0xf2, 0xff, 0xb4, 0xb9, 0xae, 0xa3,
        0x80, 0x8d, 0x9a, 0x97
        ],

        GEX = [
        0x00, 0x0e, 0x1c, 0x12, 0x38, 0x36, 0x24, 0x2a, 0x70, 0x7e, 0x6c, 0x62,
        0x48, 0x46, 0x54, 0x5a, 0xe0, 0xee, 0xfc, 0xf2, 0xd8, 0xd6, 0xc4, 0xca,
        0x90, 0x9e, 0x8c, 0x82, 0xa8, 0xa6, 0xb4, 0xba, 0xdb, 0xd5, 0xc7, 0xc9,
        0xe3, 0xed, 0xff, 0xf1, 0xab, 0xa5, 0xb7, 0xb9, 0x93, 0x9d, 0x8f, 0x81,
        0x3b, 0x35, 0x27, 0x29, 0x03, 0x0d, 0x1f, 0x11, 0x4b, 0x45, 0x57, 0x59,
        0x73, 0x7d, 0x6f, 0x61, 0xad, 0xa3, 0xb1, 0xbf, 0x95, 0x9b, 0x89, 0x87,
        0xdd, 0xd3, 0xc1, 0xcf, 0xe5, 0xeb, 0xf9, 0xf7, 0x4d, 0x43, 0x51, 0x5f,
        0x75, 0x7b, 0x69, 0x67, 0x3d, 0x33, 0x21, 0x2f, 0x05, 0x0b, 0x19, 0x17,
        0x76, 0x78, 0x6a, 0x64, 0x4e, 0x40, 0x52, 0x5c, 0x06, 0x08, 0x1a, 0x14,
        0x3e, 0x30, 0x22, 0x2c, 0x96, 0x98, 0x8a, 0x84, 0xae, 0xa0, 0xb2, 0xbc,
        0xe6, 0xe8, 0xfa, 0xf4, 0xde, 0xd0, 0xc2, 0xcc, 0x41, 0x4f, 0x5d, 0x53,
        0x79, 0x77, 0x65, 0x6b, 0x31, 0x3f, 0x2d, 0x23, 0x09, 0x07, 0x15, 0x1b,
        0xa1, 0xaf, 0xbd, 0xb3, 0x99, 0x97, 0x85, 0x8b, 0xd1, 0xdf, 0xcd, 0xc3,
        0xe9, 0xe7, 0xf5, 0xfb, 0x9a, 0x94, 0x86, 0x88, 0xa2, 0xac, 0xbe, 0xb0,
        0xea, 0xe4, 0xf6, 0xf8, 0xd2, 0xdc, 0xce, 0xc0, 0x7a, 0x74, 0x66, 0x68,
        0x42, 0x4c, 0x5e, 0x50, 0x0a, 0x04, 0x16, 0x18, 0x32, 0x3c, 0x2e, 0x20,
        0xec, 0xe2, 0xf0, 0xfe, 0xd4, 0xda, 0xc8, 0xc6, 0x9c, 0x92, 0x80, 0x8e,
        0xa4, 0xaa, 0xb8, 0xb6, 0x0c, 0x02, 0x10, 0x1e, 0x34, 0x3a, 0x28, 0x26,
        0x7c, 0x72, 0x60, 0x6e, 0x44, 0x4a, 0x58, 0x56, 0x37, 0x39, 0x2b, 0x25,
        0x0f, 0x01, 0x13, 0x1d, 0x47, 0x49, 0x5b, 0x55, 0x7f, 0x71, 0x63, 0x6d,
        0xd7, 0xd9, 0xcb, 0xc5, 0xef, 0xe1, 0xf3, 0xfd, 0xa7, 0xa9, 0xbb, 0xb5,
        0x9f, 0x91, 0x83, 0x8d
        ],

        enc = function(string, pass, binary) {
            // string, password in plaintext
            var salt = randArr(8),
            pbe = openSSLKey(s2a(pass), salt),
            key = pbe.key,
            iv = pbe.iv,
            cipherBlocks,
            saltBlock = [[83, 97, 108, 116, 101, 100, 95, 95].concat(salt)];
            if (!binary) {
                string = s2a(string);
            }
            cipherBlocks = rawEncrypt(string, key, iv);
            // Spells out 'Salted__'
            cipherBlocks = saltBlock.concat(cipherBlocks);
            return Base64.encode(cipherBlocks);
        },

        dec = function(string, pass, binary) {
            // string, password in plaintext
            var cryptArr = Base64.decode(string),
            salt = cryptArr.slice(8, 16),
            pbe = openSSLKey(s2a(pass), salt),
            key = pbe.key,
            iv = pbe.iv;
            cryptArr = cryptArr.slice(16, cryptArr.length);
            // Take off the Salted__ffeeddcc
            string = rawDecrypt(cryptArr, key, iv, binary);
            return string;
        },
        
        MD5 = function(numArr) {

            function rotateLeft(lValue, iShiftBits) {
                return (lValue << iShiftBits) | (lValue >>> (32 - iShiftBits));
            }

            function addUnsigned(lX, lY) {
                var lX4,
                lY4,
                lX8,
                lY8,
                lResult;
                lX8 = (lX & 0x80000000);
                lY8 = (lY & 0x80000000);
                lX4 = (lX & 0x40000000);
                lY4 = (lY & 0x40000000);
                lResult = (lX & 0x3FFFFFFF) + (lY & 0x3FFFFFFF);
                if (lX4 & lY4) {
                    return (lResult ^ 0x80000000 ^ lX8 ^ lY8);
                }
                if (lX4 | lY4) {
                    if (lResult & 0x40000000) {
                        return (lResult ^ 0xC0000000 ^ lX8 ^ lY8);
                    } else {
                        return (lResult ^ 0x40000000 ^ lX8 ^ lY8);
                    }
                } else {
                    return (lResult ^ lX8 ^ lY8);
                }
            }

            function f(x, y, z) {
                return (x & y) | ((~x) & z);
            }
            function g(x, y, z) {
                return (x & z) | (y & (~z));
            }
            function h(x, y, z) {
                return (x ^ y ^ z);
            }
            function funcI(x, y, z) {
                return (y ^ (x | (~z)));
            }

            function ff(a, b, c, d, x, s, ac) {
                a = addUnsigned(a, addUnsigned(addUnsigned(f(b, c, d), x), ac));
                return addUnsigned(rotateLeft(a, s), b);
            }

            function gg(a, b, c, d, x, s, ac) {
                a = addUnsigned(a, addUnsigned(addUnsigned(g(b, c, d), x), ac));
                return addUnsigned(rotateLeft(a, s), b);
            }

            function hh(a, b, c, d, x, s, ac) {
                a = addUnsigned(a, addUnsigned(addUnsigned(h(b, c, d), x), ac));
                return addUnsigned(rotateLeft(a, s), b);
            }

            function ii(a, b, c, d, x, s, ac) {
                a = addUnsigned(a, addUnsigned(addUnsigned(funcI(b, c, d), x), ac));
                return addUnsigned(rotateLeft(a, s), b);
            }

            function convertToWordArray(numArr) {
                var lWordCount,
                lMessageLength = numArr.length,
                lNumberOfWords_temp1 = lMessageLength + 8,
                lNumberOfWords_temp2 = (lNumberOfWords_temp1 - (lNumberOfWords_temp1 % 64)) / 64,
                lNumberOfWords = (lNumberOfWords_temp2 + 1) * 16,
                lWordArray = [],
                lBytePosition = 0,
                lByteCount = 0;
                while (lByteCount < lMessageLength) {
                    lWordCount = (lByteCount - (lByteCount % 4)) / 4;
                    lBytePosition = (lByteCount % 4) * 8;
                    lWordArray[lWordCount] = (lWordArray[lWordCount] | (numArr[lByteCount] << lBytePosition));
                    lByteCount++;
                }
                lWordCount = (lByteCount - (lByteCount % 4)) / 4;
                lBytePosition = (lByteCount % 4) * 8;
                lWordArray[lWordCount] = lWordArray[lWordCount] | (0x80 << lBytePosition);
                lWordArray[lNumberOfWords - 2] = lMessageLength << 3;
                lWordArray[lNumberOfWords - 1] = lMessageLength >>> 29;
                return lWordArray;
            }

            function wordToHex(lValue) {
                var lByte,
                lCount,
                wordToHexArr = [];
                for (lCount = 0; lCount <= 3; lCount++) {
                    lByte = (lValue >>> (lCount * 8)) & 255;
                    wordToHexArr = wordToHexArr.concat(lByte);
                 }
                return wordToHexArr;
            }

            /*function utf8Encode(string) {
                string = string.replace(/\r\n/g, "\n");
                var utftext = "",
                n,
                c;

                for (n = 0; n < string.length; n++) {

                    c = string.charCodeAt(n);

                    if (c < 128) {
                        utftext += String.fromCharCode(c);
                    }
                    else if ((c > 127) && (c < 2048)) {
                        utftext += String.fromCharCode((c >> 6) | 192);
                        utftext += String.fromCharCode((c & 63) | 128);
                    }
                    else {
                        utftext += String.fromCharCode((c >> 12) | 224);
                        utftext += String.fromCharCode(((c >> 6) & 63) | 128);
                        utftext += String.fromCharCode((c & 63) | 128);
                    }

                }

                return utftext;
            }*/

            var x = [],
            k,
            AA,
            BB,
            CC,
            DD,
            a,
            b,
            c,
            d,
            S11 = 7,
            S12 = 12,
            S13 = 17,
            S14 = 22,
            S21 = 5,
            S22 = 9,
            S23 = 14,
            S24 = 20,
            S31 = 4,
            S32 = 11,
            S33 = 16,
            S34 = 23,
            S41 = 6,
            S42 = 10,
            S43 = 15,
            S44 = 21;

            x = convertToWordArray(numArr);

            a = 0x67452301;
            b = 0xEFCDAB89;
            c = 0x98BADCFE;
            d = 0x10325476;

            for (k = 0; k < x.length; k += 16) {
                AA = a;
                BB = b;
                CC = c;
                DD = d;
                a = ff(a, b, c, d, x[k + 0], S11, 0xD76AA478);
                d = ff(d, a, b, c, x[k + 1], S12, 0xE8C7B756);
                c = ff(c, d, a, b, x[k + 2], S13, 0x242070DB);
                b = ff(b, c, d, a, x[k + 3], S14, 0xC1BDCEEE);
                a = ff(a, b, c, d, x[k + 4], S11, 0xF57C0FAF);
                d = ff(d, a, b, c, x[k + 5], S12, 0x4787C62A);
                c = ff(c, d, a, b, x[k + 6], S13, 0xA8304613);
                b = ff(b, c, d, a, x[k + 7], S14, 0xFD469501);
                a = ff(a, b, c, d, x[k + 8], S11, 0x698098D8);
                d = ff(d, a, b, c, x[k + 9], S12, 0x8B44F7AF);
                c = ff(c, d, a, b, x[k + 10], S13, 0xFFFF5BB1);
                b = ff(b, c, d, a, x[k + 11], S14, 0x895CD7BE);
                a = ff(a, b, c, d, x[k + 12], S11, 0x6B901122);
                d = ff(d, a, b, c, x[k + 13], S12, 0xFD987193);
                c = ff(c, d, a, b, x[k + 14], S13, 0xA679438E);
                b = ff(b, c, d, a, x[k + 15], S14, 0x49B40821);
                a = gg(a, b, c, d, x[k + 1], S21, 0xF61E2562);
                d = gg(d, a, b, c, x[k + 6], S22, 0xC040B340);
                c = gg(c, d, a, b, x[k + 11], S23, 0x265E5A51);
                b = gg(b, c, d, a, x[k + 0], S24, 0xE9B6C7AA);
                a = gg(a, b, c, d, x[k + 5], S21, 0xD62F105D);
                d = gg(d, a, b, c, x[k + 10], S22, 0x2441453);
                c = gg(c, d, a, b, x[k + 15], S23, 0xD8A1E681);
                b = gg(b, c, d, a, x[k + 4], S24, 0xE7D3FBC8);
                a = gg(a, b, c, d, x[k + 9], S21, 0x21E1CDE6);
                d = gg(d, a, b, c, x[k + 14], S22, 0xC33707D6);
                c = gg(c, d, a, b, x[k + 3], S23, 0xF4D50D87);
                b = gg(b, c, d, a, x[k + 8], S24, 0x455A14ED);
                a = gg(a, b, c, d, x[k + 13], S21, 0xA9E3E905);
                d = gg(d, a, b, c, x[k + 2], S22, 0xFCEFA3F8);
                c = gg(c, d, a, b, x[k + 7], S23, 0x676F02D9);
                b = gg(b, c, d, a, x[k + 12], S24, 0x8D2A4C8A);
                a = hh(a, b, c, d, x[k + 5], S31, 0xFFFA3942);
                d = hh(d, a, b, c, x[k + 8], S32, 0x8771F681);
                c = hh(c, d, a, b, x[k + 11], S33, 0x6D9D6122);
                b = hh(b, c, d, a, x[k + 14], S34, 0xFDE5380C);
                a = hh(a, b, c, d, x[k + 1], S31, 0xA4BEEA44);
                d = hh(d, a, b, c, x[k + 4], S32, 0x4BDECFA9);
                c = hh(c, d, a, b, x[k + 7], S33, 0xF6BB4B60);
                b = hh(b, c, d, a, x[k + 10], S34, 0xBEBFBC70);
                a = hh(a, b, c, d, x[k + 13], S31, 0x289B7EC6);
                d = hh(d, a, b, c, x[k + 0], S32, 0xEAA127FA);
                c = hh(c, d, a, b, x[k + 3], S33, 0xD4EF3085);
                b = hh(b, c, d, a, x[k + 6], S34, 0x4881D05);
                a = hh(a, b, c, d, x[k + 9], S31, 0xD9D4D039);
                d = hh(d, a, b, c, x[k + 12], S32, 0xE6DB99E5);
                c = hh(c, d, a, b, x[k + 15], S33, 0x1FA27CF8);
                b = hh(b, c, d, a, x[k + 2], S34, 0xC4AC5665);
                a = ii(a, b, c, d, x[k + 0], S41, 0xF4292244);
                d = ii(d, a, b, c, x[k + 7], S42, 0x432AFF97);
                c = ii(c, d, a, b, x[k + 14], S43, 0xAB9423A7);
                b = ii(b, c, d, a, x[k + 5], S44, 0xFC93A039);
                a = ii(a, b, c, d, x[k + 12], S41, 0x655B59C3);
                d = ii(d, a, b, c, x[k + 3], S42, 0x8F0CCC92);
                c = ii(c, d, a, b, x[k + 10], S43, 0xFFEFF47D);
                b = ii(b, c, d, a, x[k + 1], S44, 0x85845DD1);
                a = ii(a, b, c, d, x[k + 8], S41, 0x6FA87E4F);
                d = ii(d, a, b, c, x[k + 15], S42, 0xFE2CE6E0);
                c = ii(c, d, a, b, x[k + 6], S43, 0xA3014314);
                b = ii(b, c, d, a, x[k + 13], S44, 0x4E0811A1);
                a = ii(a, b, c, d, x[k + 4], S41, 0xF7537E82);
                d = ii(d, a, b, c, x[k + 11], S42, 0xBD3AF235);
                c = ii(c, d, a, b, x[k + 2], S43, 0x2AD7D2BB);
                b = ii(b, c, d, a, x[k + 9], S44, 0xEB86D391);
                a = addUnsigned(a, AA);
                b = addUnsigned(b, BB);
                c = addUnsigned(c, CC);
                d = addUnsigned(d, DD);
            }

            return wordToHex(a).concat(wordToHex(b), wordToHex(c), wordToHex(d));
        },
        

        Base64 = (function(){
            // Takes a Nx16x1 byte array and converts it to Base64
            var _chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/',
            chars = _chars.split(''),
            
            encode = function(b, withBreaks) {
                var flatArr = [],
                b64 = '',
                i,
                broken_b64;
                totalChunks = Math.floor(b.length * 16 / 3);
                for (i = 0; i < b.length * 16; i++) {
                    flatArr.push(b[Math.floor(i / 16)][i % 16]);
                }
                for (i = 0; i < flatArr.length; i = i + 3) {
                    b64 += chars[flatArr[i] >> 2];
                    b64 += chars[((flatArr[i] & 3) << 4) | (flatArr[i + 1] >> 4)];
                    if (! (flatArr[i + 1] === undefined)) {
                        b64 += chars[((flatArr[i + 1] & 15) << 2) | (flatArr[i + 2] >> 6)];
                    } else {
                        b64 += '=';
                    }
                    if (! (flatArr[i + 2] === undefined)) {
                        b64 += chars[flatArr[i + 2] & 63];
                    } else {
                        b64 += '=';
                    }
                }
                // OpenSSL is super particular about line breaks
                broken_b64 = b64.slice(0, 64) + '\n';
                for (i = 1; i < (Math.ceil(b64.length / 64)); i++) {
                    broken_b64 += b64.slice(i * 64, i * 64 + 64) + (Math.ceil(b64.length / 64) == i + 1 ? '': '\n');
                }
                return broken_b64;
            },
            
            decode = function(string) {
                string = string.replace(/\n/g, '');
                var flatArr = [],
                c = [],
                b = [],
                i;
                for (i = 0; i < string.length; i = i + 4) {
                    c[0] = _chars.indexOf(string.charAt(i));
                    c[1] = _chars.indexOf(string.charAt(i + 1));
                    c[2] = _chars.indexOf(string.charAt(i + 2));
                    c[3] = _chars.indexOf(string.charAt(i + 3));

                    b[0] = (c[0] << 2) | (c[1] >> 4);
                    b[1] = ((c[1] & 15) << 4) | (c[2] >> 2);
                    b[2] = ((c[2] & 3) << 6) | c[3];
                    flatArr.push(b[0], b[1], b[2]);
                }
                flatArr = flatArr.slice(0, flatArr.length - (flatArr.length % 16));
                return flatArr;
            };
            
            //internet explorer
            if(typeof Array.indexOf === "function") {
                _chars = chars;
            }
            
            /*
            //other way to solve internet explorer problem
            if(!Array.indexOf){
                Array.prototype.indexOf = function(obj){
                    for(var i=0; i<this.length; i++){
                        if(this[i]===obj){
                            return i;
                        }
                    }
                    return -1;
                }
            }
            */
            
            
            return {
                "encode": encode,
                "decode": decode
            };
        })();

        return {
            "size": size,
            "h2a":h2a,
            "expandKey":expandKey,
            "encryptBlock":encryptBlock,
            "decryptBlock":decryptBlock,
            "Decrypt":Decrypt,
            "s2a":s2a,
            "rawEncrypt":rawEncrypt,
            "dec":dec,
            "openSSLKey":openSSLKey,
            "a2h":a2h,
            "enc":enc,
            "Hash":{"MD5":MD5},
            "Base64":Base64
        };

    })();

})(phantom);
