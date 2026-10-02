(function($) {
    "use strict";
    
    
    // WINDOW.LOAD FUNCTION start
    $(window).load(function() {
		
        // preloader
        $("#preloader").fadeOut(1400);
        $("#preloader-status").delay(300).fadeOut("slow");
		
        // elements.Timeout
        setTimeout(function() {
            $(".introduction").delay(2400).css({
                display: "none"
            }).fadeIn(2000);
        });
        setTimeout(function() {
            $(".logo, #menu, #header").removeClass("top-position");
        }, 2200);
        setTimeout(function() {
            $(".bottom-credits, .social-icons-wrapper-share").removeClass("bottom-position");
        }, 2200);
        setTimeout(function() {
            $(".line-left").removeClass("left-position");
        }, 2200);
        setTimeout(function() {
            $(".line-right").removeClass("right-position");
        }, 2200);
        setTimeout(function() {
            $(".border-top").removeClass("top-position");
        }, 2000);
        setTimeout(function() {
            $(".border-left").removeClass("left-position");
        }, 2000);
        setTimeout(function() {
            $(".border-right").removeClass("right-position");
        }, 2000);
        setTimeout(function() {
            $(".border-bottom").removeClass("bottom-position");
        }, 2000);
		
        // hero scale IN
        $(".hero-bg").addClass("hero-bg-show");
	
    });
    // WINDOW.LOAD FUNCTION end
	
	
    // DOCUMENT.READY FUNCTION start
    $(document).ready(function() {
		
        // kenburnsy
        $("#kenburnsy-bg").kenburnsy({
            fullscreen: true
        });
		
        // owlCarousel HERO slider
        $(".hero-slider").owlCarousel({
            autoPlay: true,
            navigation: true,
            navigationText: ["<img src='img/hero-slider-arrow-left.png'>", "<img src='img/hero-slider-arrow-right.png'>"],
            pagination: true,
            slideSpeed: 300,
            paginationSpeed: 400,
            singleItem: true,
            items: 1,
            autoHeight: true,
            addClassActive: true,
            beforeMove: function() {
                // slide BEFORE (hide captions) 
            },
            afterMove: function() {
                // slide AFTER (show captions)   
            }
        });
		
		// owlCarousel HERO slider ZOOM
        $(".hero-slider-zoom").owlCarousel({
            autoPlay: true,
            navigation: true,
            navigationText: ["<img src='img/hero-slider-arrow-left.png'>", "<img src='img/hero-slider-arrow-right.png'>"],
            pagination: true,
			transitionStyle: "fadeUp", // fade, backSlide, goDown, fadeUp
            slideSpeed: 300,
            paginationSpeed: 400,
            singleItem: true,
            items: 1,
            autoHeight: true,
            addClassActive: true,
            beforeMove: function() {
                // slide BEFORE (hide captions) 
            },
            afterMove: function() {
                // slide AFTER (show captions)   
            }
        });
		
		// owlCarousel HERO slider SPLIT
        $(".hero-slider-split").owlCarousel({
            autoPlay: true,
            navigation: false,
            pagination: false,
            slideSpeed: 300,
            paginationSpeed: 800,
            singleItem: false,
            items: 2,
            autoHeight: true
        });
		
        // owlCarousel TEAM slider
        $("#team-carousel").owlCarousel({
            items: 3,
            autoPlay: false,
            stopOnHover: true,
            slideSpeed: 500,
            itemsDesktopSmall: [1200, 2],
            itemsTablet: [740, 2],
            itemsMobile: [520, 1]
        });
		
        // owlCarousel testimonials
        $("#testimonials").owlCarousel({
            navigation: false,
            pagination: true,
            transitionStyle: "backSlide", // fade, backSlide, goDown, fadeUp
            slideSpeed: 500,
            paginationSpeed: 500,
            singleItem: true,
            autoPlay: 7000
        });
		
		// owlCarousel TIME slides
        $(".time-slides").owlCarousel({
            navigation: false,
            pagination: false,
            transitionStyle: "fade", // fade, backSlide, goDown, fadeUp
            slideSpeed: 300,
            paginationSpeed: 400,
            singleItem: true,
            autoPlay: 5000
        });
		
		// owlCarousel NEWS slider
        $("#news-carousel").owlCarousel({
            navigation: false,
            pagination: true,
            transitionStyle: "backSlide", // fade, backSlide, goDown, fadeUp
            slideSpeed: 500,
            paginationSpeed: 500,
            singleItem: true,
            // autoPlay: 7000
			autoPlay: false
        });
		
		// owlCarousel NEWS IMG slider 1
        $("#news-img-carousel-1").owlCarousel({
            navigation: false,
            pagination: true,
            transitionStyle: "fade", // fade, backSlide, goDown, fadeUp
            slideSpeed: 500,
            paginationSpeed: 500,
            singleItem: true,
            // autoPlay: 7000
			autoPlay: false
        });
		
		// owlCarousel NEWS IMG slider 2
        $("#news-img-carousel-2").owlCarousel({
            navigation: false,
            pagination: true,
            transitionStyle: "fade", // fade, backSlide, goDown, fadeUp
            slideSpeed: 500,
            paginationSpeed: 500,
            singleItem: true,
            // autoPlay: 7000
			autoPlay: false
        });
		
        // signup form
        $(".ex-modal-launcher").on("click", function(e) {
            e.preventDefault();
            $(this).toggleClass("open");
            $(".ex-modal").toggleClass("show");
        });
		
        // search form
        $(".search-modal-launcher").on("click", function(e) {
            e.preventDefault();
            $(this).toggleClass("open");
            $(".search-modal").toggleClass("show");
        });
		
        // menu button
        $('.menu').click(function() {
            $(this).toggleClass('open');
        });
		
        // social icons share
        $(".social-toggle-wrap").hover(function() {
            $(this).find(".social-widgets-wrap").stop().fadeIn("slow");
        }, function() {
            $(this).find(".social-widgets-wrap").stop().delay(50).fadeOut("slow");
        });
		
        // YTPlayer
        $(function() {
            $(".player").mb_YTPlayer();
        });
		
        // contact form
        $("form#form").submit(function() {
            $("form#form .error").remove();
            var s = !1;
            if ($(".requiredField").each(function() {
                if ("" === jQuery.trim($(this).val())) $(this).prev("label").text(), $(this).parent().append('<span class="error">This field is required</span>'), $(this).addClass(
                    "inputError"), s = !0;
                else if ($(this).hasClass("email")) {
                    var r = /^([\w-\.]+@([\w-]+\.)+[\w-]{2,4})?$/;
                    r.test(jQuery.trim($(this).val())) || ($(this).prev("label").text(), $(this).parent().append('<span class="error">Invalid email address</span>'), $(
                        this).addClass("inputError"), s = !0);
                }
            }), !s) {
                $("form#form input.submit").fadeOut("normal", function() {
                    $(this).parent().append("");
                });
                var r = $(this).serialize();
                $.post($(this).attr("action"), r, function() {
                    $("form#form").slideUp("fast", function() {
                        $(this).before('<div class="success">Your email was sent successfully.</div>');
                    });
                });
            }
            return !1;
        });
		
        // newsletter form
        $("form#subscribe").submit(function() {
            $("form#subscribe .subscribe-error").remove();
            var s = !1;
            if ($(".subscribe-requiredField").each(function() {
                if ("" === jQuery.trim($(this).val())) $(this).prev("label").text(), $(this).parent().append('<span class="subscribe-error">Please enter your Email</span>'),
                    $(this).addClass("inputError"), s = !0;
                else if ($(this).hasClass("subscribe-email")) {
                    var r = /^([\w-\.]+@([\w-]+\.)+[\w-]{2,4})?$/;
                    r.test(jQuery.trim($(this).val())) || ($(this).prev("label").text(), $(this).parent().append(
                        '<span class="subscribe-error">Please enter a valid Email</span>'), $(this).addClass("inputError"), s = !0);
                }
            }), !s) {
                $("form#subscribe input.submit").fadeOut("normal", function() {
                    $(this).parent().append("");
                });
                var r = $(this).serialize();
                $.post($(this).attr("action"), r, function() {
                    $("form#subscribe").slideUp("fast", function() {
                        $(this).before('<div class="subscribe-success">Thank you for subscribing.</div>');
                    });
                });
            }
            return !1;
        });
		
		// magnificPopup VIDEO
		$('.popup-video').magnificPopup({
          disableOn: 700,
          type: 'iframe',
          mainClass: 'mfp-fade',
          removalDelay: 160,
          preloader: false,

          fixedContentPos: false
        });
		
		// Vimeofy
		$('#videoContainment-vimeo').vimeofy({
            'url': 'https://vimeo.com/105001064', // Vimeo VIDEO URL
            'color': '#00D8D8',
            'autoplay': true,
            'loop': true,
            'delay': 5000
        });
	
    });
    // DOCUMENT.READY FUNCTION end
	
	
    // on.scroll FADE FUNCTION start
    $(window).scroll(function() {
		
        var scrollTop = $(window).scrollTop();
        var height = $(window).height();
        $('.alternative-borders, .line-left, .line-right').css({
            'opacity': ((height - scrollTop) / height)
        });
	
    });
    // on.scroll FADE FUNCTION end
	
	
    // MOBILE DETECT start
    var isMobile = {
        Android: function() {
            return navigator.userAgent.match(/Android/i);
        },
        BlackBerry: function() {
            return navigator.userAgent.match(/BlackBerry/i);
        },
        iOS: function() {
            return navigator.userAgent.match(/iPhone|iPad|iPod/i);
        },
        Opera: function() {
            return navigator.userAgent.match(/Opera Mini/i);
        },
        Windows: function() {
            return navigator.userAgent.match(/IEMobile/i);
        },
        any: function() {
            return (isMobile.Android() || isMobile.BlackBerry() || isMobile.iOS() || isMobile.Opera() || isMobile.Windows());
        }
    };
    // MOBILE DETECT end
    
    
})(jQuery);